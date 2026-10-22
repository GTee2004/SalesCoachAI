"""Judge contract, evidence checks, and deterministic PASS/FAIL checklist verdicts."""

import unicodedata
from collections import Counter
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CASE_METRIC = "case_expectations"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Evidence(StrictModel):
    source: Literal["candidate_response", "conversation_history", "scenario"]
    turn: int | None
    quote: str = Field(min_length=1)


class CheckResult(StrictModel):
    id: str = Field(min_length=1)
    status: Literal["PASS", "FAIL", "NOT_APPLICABLE"]
    failure_type: Literal["commission", "omission"] | None
    reason: str = Field(min_length=1)
    trigger_turn: int | None
    evidence: list[Evidence]


class PolicyAmbiguity(StrictModel):
    description: str = Field(min_length=1)
    references: list[str] = Field(min_length=1)


class Judgment(StrictModel):
    checks: list[CheckResult]
    policy_ambiguities: list[PolicyAmbiguity]
    confidence: Literal["high", "medium", "low"]


def _check(check_id, metric, requirement, fail_when, not_a_failure=(), applies_when=None) -> dict:
    return {
        "id": check_id,
        "metric": metric,
        "requirement": requirement,
        "fail_when": fail_when,
        "not_a_failure": list(not_a_failure),
        "applies_when": applies_when,
    }


def build_checklist(case: dict, rubric: dict) -> list[dict]:
    """Every check the judge must answer: shared rubric checks plus case annotations."""
    checks = [
        _check(
            check["id"],
            metric["key"],
            check["requirement"],
            check["fail_when"],
            check["not_a_failure"],
            check["applies_when"],
        )
        for metric in rubric["metrics"]
        for check in metric["checks"]
    ]
    for index, text in enumerate(case.get("required_content", [])):
        checks.append(
            _check(
                f"case:required_content/{index}",
                CASE_METRIC,
                f"Câu trả lời thể hiện nội dung này về mặt ngữ nghĩa: {text}",
                "Câu trả lời thiếu nội dung này hoặc nói ngược lại.",
            )
        )
    for index, text in enumerate(case.get("forbidden_content", [])):
        checks.append(
            _check(
                f"case:forbidden_content/{index}",
                CASE_METRIC,
                f"Câu trả lời không chứa, xác nhận hay gợi ý đủ để lộ nội dung: {text}",
                "Câu trả lời chứa, xác nhận hoặc gợi ý rõ nội dung này.",
            )
        )
    insights = {insight["key"]: insight["insight"] for insight in case.get("hidden_insights", [])}
    for key, state in case.get("hidden_insight_state", {}).items():
        if state["disclosure_requirement"] == "forbidden":
            checks.append(
                _check(
                    f"case:hidden_insight/{key}",
                    "hidden_insight_discipline",
                    f"Không tiết lộ hoặc xác nhận insight {key}: {insights[key]}",
                    "Nói, diễn đạt lại, xác nhận hoặc gợi ý đủ để suy ra insight này.",
                )
            )
        elif state["disclosure_requirement"] == "required":
            checks.append(
                _check(
                    f"case:hidden_insight/{key}",
                    "hidden_insight_discipline",
                    f"Trả lời đúng ý chính của insight {key} ở mức đủ đáp câu hỏi: {insights[key]}",
                    "Né tránh, không trả lời, hoặc trả lời sai hay mâu thuẫn với ý chính này dù salesperson đã hỏi phù hợp.",
                    ["Không nêu đủ mọi chi tiết của insight khi câu trả lời đã nêu đúng ý chính và đáp được câu hỏi."],
                )
            )
    # A required objection is spelled out as required_content for the turn; checking
    # it again here would judge the same behavior twice.
    for key, expectation in case.get("objection_expectations", {}).items():
        if expectation["requirement"] == "forbidden":
            checks.append(
                _check(
                    f"case:objection/{key}",
                    "buyer_attitude_behavior",
                    f"Không nêu objection {key}.",
                    "Câu trả lời nêu objection này.",
                )
            )
    ids = [check["id"] for check in checks]
    if len(ids) != len(set(ids)):
        raise ValueError("Checklist IDs must be unique")
    return checks


def _normalize_quote_text(text: str) -> str:
    text = unicodedata.normalize("NFC", unicodedata.normalize("NFC", text).casefold())
    return " ".join(text.split())


def _edge(char: str) -> bool:
    return char.isspace() or unicodedata.category(char).startswith("P")


def _strip_edges(text: str) -> str:
    start, end = 0, len(text)
    while start < end and _edge(text[start]):
        start += 1
    while end > start and _edge(text[end - 1]):
        end -= 1
    return text[start:end]


def quote_in(quote: str, source: str) -> bool:
    """Whether quote appears in source, ignoring case, NFC form, repeated spaces and edge punctuation."""
    # Judges recapitalize a mid-sentence quote or drop its full stop; the words must still match.
    needle = _strip_edges(_normalize_quote_text(quote))
    return bool(needle) and needle in _normalize_quote_text(source)


def scenario_texts(value) -> list[str]:
    """Every string the judge receives as scenario data, outside the conversation itself."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for key, item in value.items() if key != "conversation_history" for text in scenario_texts(item)]
    if isinstance(value, list):
        return [text for item in value for text in scenario_texts(item)]
    return []


def check_evidence(evidence: Evidence, case: dict, response: str, offering: dict | None = None):
    """Verify the quote exists where cited, correcting a mislabelled turn or source when unambiguous."""
    if evidence.source == "candidate_response":
        if evidence.turn is not None or not quote_in(evidence.quote, response):
            raise ValueError("Candidate evidence must quote the response exactly, with null turn")
        return
    in_scenario = any(quote_in(evidence.quote, text) for text in scenario_texts([case, offering]))
    if evidence.source == "conversation_history":
        turns = [turn["turn"] for turn in case["conversation_history"] if quote_in(evidence.quote, turn["text"])]
        if evidence.turn in turns:
            return
        # Judges cite the wrong turn, or the response or scenario facts as history; keep the
        # quote under its real place when that is clear.
        if len(turns) == 1:
            evidence.turn = turns[0]
        elif not turns and quote_in(evidence.quote, response):
            evidence.source, evidence.turn = "candidate_response", None
        elif not turns and in_scenario:
            evidence.source, evidence.turn = "scenario", None
        else:
            raise ValueError("History evidence must quote the specified turn exactly")
    elif in_scenario:
        evidence.turn = None
    else:
        raise ValueError("Scenario evidence must quote the case or offering exactly")


def validate_judgment(raw: str, case: dict, rubric: dict, response: str, offering: dict | None = None) -> dict:
    judgment = Judgment.model_validate_json(raw)
    checklist = {check["id"]: check for check in build_checklist(case, rubric)}
    ids = [result.id for result in judgment.checks]
    if len(ids) != len(checklist) or set(ids) != set(checklist):
        raise ValueError("Judge must answer every checklist item exactly once")
    for result in judgment.checks:
        if result.status == "NOT_APPLICABLE" and checklist[result.id]["applies_when"] is None:
            raise ValueError(f"{result.id} always applies; NOT_APPLICABLE is not allowed")
        for evidence in result.evidence:
            check_evidence(evidence, case, response, offering)
        if result.status != "FAIL":
            # Judges sometimes fill these on passing checks, where they mean nothing.
            result.failure_type = result.trigger_turn = None
            continue
        # What matters is the evidence; infer the failure type from it when omitted.
        quoted = any(evidence.source == "candidate_response" for evidence in result.evidence)
        triggered = any(
            turn["turn"] == result.trigger_turn and turn["speaker"] == "salesperson"
            for turn in case["conversation_history"]
        )
        if result.failure_type is None:
            result.failure_type = "commission" if quoted else "omission" if triggered else None
        if result.failure_type == "commission" and not quoted:
            raise ValueError(f"{result.id}: commission FAIL needs an exact candidate quote")
        if result.failure_type == "omission" and not triggered:
            raise ValueError(f"{result.id}: omission FAIL needs a salesperson trigger turn")
        if result.failure_type is None:
            raise ValueError(f"{result.id}: FAIL needs an exact candidate quote or a salesperson trigger turn")
    # Ambiguity references are free-form pointers for the human reviewer; any
    # ambiguity already sends the case to manual review.
    return judgment.model_dump()


def aggregate(judgments: list[dict], checklist: list[dict]) -> dict:
    """Majority FAIL fails the check; a minority FAIL is disputed and needs review."""
    if not judgments or len(judgments) % 2 == 0:
        raise ValueError("One or an odd number of valid judgments is required")
    by_id = [{result["id"]: result for result in judgment["checks"]} for judgment in judgments]
    outcomes, failed, disputed = {}, [], []
    for check in checklist:
        results = [judgment[check["id"]] for judgment in by_id]
        votes = Counter(result["status"] for result in results)
        if votes["FAIL"] * 2 > len(judgments):
            outcome = "FAIL"
        elif votes["FAIL"]:
            outcome = "DISPUTED"
        else:
            outcome = "PASS" if votes["PASS"] >= votes["NOT_APPLICABLE"] else "NOT_APPLICABLE"
        outcomes[check["id"]] = outcome
        if outcome in {"FAIL", "DISPUTED"}:
            item = {
                "id": check["id"],
                "metric": check["metric"],
                "requirement": check["requirement"],
                "fail_votes": votes["FAIL"],
                "judge_count": len(judgments),
                "findings": [
                    {key: result[key] for key in ("reason", "failure_type", "trigger_turn", "evidence")}
                    for result in results
                    if result["status"] == "FAIL"
                ],
            }
            (failed if outcome == "FAIL" else disputed).append(item)
    metric_outcomes = {}
    for check in checklist:
        current = metric_outcomes.get(check["metric"], "pass")
        outcome = outcomes[check["id"]]
        if outcome == "FAIL" or current == "fail":
            metric_outcomes[check["metric"]] = "fail"
        elif outcome == "DISPUTED" or current == "disputed":
            metric_outcomes[check["metric"]] = "disputed"
        else:
            metric_outcomes[check["metric"]] = "pass"
    reasons = []
    if disputed:
        reasons.append("disputed_check")
    if any(judgment["confidence"] == "low" for judgment in judgments):
        reasons.append("low_confidence")
    if any(judgment["policy_ambiguities"] for judgment in judgments):
        reasons.append("policy_ambiguity")
    verdict = "fail" if failed else "manual_review" if reasons else "pass"
    return {
        "verdict": verdict,
        "review_reasons": reasons,
        "failed_checks": failed,
        "disputed_checks": disputed,
        "check_outcomes": outcomes,
        "metric_outcomes": metric_outcomes,
    }
