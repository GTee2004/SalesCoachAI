"""Offline regression checks: no model calls or application startup."""

import json
import threading
import unicodedata
from argparse import Namespace
from copy import deepcopy

import httpx
import pytest

from eval.buyer import run_evaluation as runner
from eval.buyer.scenario import generation_fixture
from eval.buyer.scoring import aggregate, build_checklist, validate_judgment

DATASET = runner.read_json(runner.DEFAULT_DATASET)
RUBRIC = runner.read_json(runner.DEFAULT_DATASET.parent / DATASET["rubric_ref"]["path"])
CASE = runner.judge_case(DATASET["cases"][0])
OFFERING = DATASET["offerings"][DATASET["cases"][0]["offering_id"]]
RESPONSE = "Phòng thứ hai hai vợ chồng anh dùng để làm việc ở nhà."
CHECKLIST = build_checklist(CASE, RUBRIC)
PROVIDER_ENV = (
    "VOICE_AGENT_LLM_BASE_URL",
    "VOICE_AGENT_LLM_MODEL",
    "VOICE_AGENT_LLM_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "EVAL_JUDGE_LLM_BASE_URL",
    "EVAL_JUDGE_LLM_API_KEY",
    "EVAL_JUDGE_LLM_MODEL",
)
JUDGE_MODEL = "offline-judge-model"


@pytest.fixture(autouse=True)
def isolated_provider_env(monkeypatch):
    # The runner loads the repository .env; keep real endpoints and keys out of tests.
    monkeypatch.setattr(runner, "load_dotenv", lambda *args, **kwargs: None)
    for name in PROVIDER_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("EVAL_JUDGE_LLM_MODEL", JUDGE_MODEL)


def judgment():
    return {
        "checks": [
            {
                "id": check["id"],
                "status": "PASS",
                "failure_type": None,
                "reason": "Đáp ứng yêu cầu.",
                "trigger_turn": None,
                "evidence": [],
            }
            for check in CHECKLIST
        ],
        "policy_ambiguities": [],
        "confidence": "high",
    }


def result(value, check_id):
    return next(item for item in value["checks"] if item["id"] == check_id)


def fail(value, check_id="case:hidden_insight/wife_evening_calls", quote="ở nhà"):
    result(value, check_id).update(
        status="FAIL",
        failure_type="commission",
        reason="Protected fact disclosed.",
        evidence=[{"source": "candidate_response", "turn": None, "quote": quote}],
    )
    return value


def omission(value, check_id="case:hidden_insight/shared_home_office", turn=2):
    result(value, check_id).update(
        status="FAIL", failure_type="omission", reason="Required content missing.", trigger_turn=turn
    )
    return value


def validate(value):
    return validate_judgment(json.dumps(value, ensure_ascii=False), CASE, RUBRIC, RESPONSE, OFFERING)


def test_dataset_validation_and_production_renderer():
    runner.validate_inputs(DATASET, RUBRIC)
    fixtures = [
        generation_fixture(case, DATASET["offerings"][case["offering_id"]], DATASET["locale"])
        for case in DATASET["cases"]
    ]
    rendered = runner.render_prompts(fixtures)
    assert len(rendered) == len(DATASET["cases"])
    assert {item["prompt_version"] for item in rendered.values()} == {"buyer-v1"}
    assert all("NGƯỜI MUA" in item["system_prompt"] for item in rendered.values())
    assert "3,9 tỷ" in rendered["buyer_text_eval_002"]["system_prompt"]
    assert all("tháng 10/2026" in item["system_prompt"] for item in rendered.values())
    assert "rentalReference" in rendered["buyer_text_eval_004"]["system_prompt"]


def test_oracle_annotations_cannot_change_generation_inputs():
    original = DATASET["cases"][0]
    edited = deepcopy(original)
    for key in (
        "hidden_insight_state",
        "required_content",
        "optional_content",
        "allowed_content",
        "forbidden_content",
        "expected_behavior",
        "objection_expectations",
        "reference_response",
        "focus_metrics",
        "evaluation_goal",
    ):
        edited[key] = "ORACLE_SENTINEL"
    fixture = generation_fixture(edited, OFFERING, DATASET["locale"])
    assert fixture == generation_fixture(original, OFFERING, DATASET["locale"])
    assert "ORACLE_SENTINEL" not in json.dumps(fixture)
    assert "urgency" not in fixture["runtime"]["config"]["buyer"]


def test_judge_does_not_see_reference_or_benchmark_metadata():
    body = runner.judge_request(DATASET["cases"][0], OFFERING, RUBRIC, RESPONSE, "judge", {}, "json_schema")
    payload = json.loads(body["messages"][1]["content"])
    assert [check["id"] for check in payload["checklist"]] == [check["id"] for check in CHECKLIST]
    assert "reference_response" not in payload["case"]
    assert "difficulty" not in payload["case"]
    assert "required_content" in payload["case"]
    assert body["response_format"]["json_schema"]["strict"] is True


def test_checklist_covers_rubric_and_case_annotations():
    ids = [check["id"] for check in CHECKLIST]
    rubric_ids = [check["id"] for metric in RUBRIC["metrics"] for check in metric["checks"]]
    assert ids[: len(rubric_ids)] == rubric_ids
    assert ids[len(rubric_ids) :] == [
        "case:forbidden_content/0",
        "case:hidden_insight/shared_home_office",  # required
        "case:hidden_insight/wife_evening_calls",  # forbidden
    ]  # the optional objection creates no check
    case_002 = build_checklist(runner.judge_case(DATASET["cases"][1]), RUBRIC)
    assert "case:required_content/1" in [check["id"] for check in case_002]
    assert not any(check["id"].startswith("case:objection/") for check in case_002)  # required objection


def test_any_single_failed_check_fails_the_case():
    assert aggregate([judgment()], CHECKLIST)["verdict"] == "pass"
    for check_id in ("N03", "PC04", "case:forbidden_content/0"):
        result_ = aggregate([fail(judgment(), check_id)], CHECKLIST)
        assert result_["verdict"] == "fail"
        assert [item["id"] for item in result_["failed_checks"]] == [check_id]
    outcome = aggregate([fail(judgment(), "N03")], CHECKLIST)
    assert outcome["metric_outcomes"]["naturalness"] == "fail"
    assert outcome["metric_outcomes"]["persona_consistency"] == "pass"


def test_not_applicable_does_not_fail_and_is_only_allowed_for_conditional_checks():
    value = judgment()
    result(value, "PC03")["status"] = "NOT_APPLICABLE"
    validate(value)
    assert aggregate([value], CHECKLIST)["check_outcomes"]["PC03"] == "NOT_APPLICABLE"
    assert aggregate([value], CHECKLIST)["verdict"] == "pass"
    result(value, "PC01")["status"] = "NOT_APPLICABLE"
    with pytest.raises(ValueError, match="always applies"):
        validate(value)
    value = judgment()
    result(value, "case:forbidden_content/0")["status"] = "NOT_APPLICABLE"
    with pytest.raises(ValueError, match="always applies"):
        validate(value)


def test_majority_fail_fails_and_minority_fail_is_disputed():
    assert aggregate([fail(judgment()), fail(judgment()), judgment()], CHECKLIST)["verdict"] == "fail"
    result_ = aggregate([fail(judgment()), judgment(), judgment()], CHECKLIST)
    assert result_["verdict"] == "manual_review"
    assert result_["review_reasons"] == ["disputed_check"]
    assert result_["disputed_checks"][0]["fail_votes"] == 1
    assert result_["metric_outcomes"]["hidden_insight_discipline"] == "disputed"


def test_confirmed_fail_precedes_uncertainty():
    value = judgment()
    value["confidence"] = "low"
    assert aggregate([value], CHECKLIST)["verdict"] == "manual_review"
    assert aggregate([fail(value)], CHECKLIST)["verdict"] == "fail"


def test_complete_judgment_and_known_statuses():
    assert validate(judgment())["confidence"] == "high"
    value = judgment()
    value["checks"].pop()
    with pytest.raises(ValueError, match="every checklist item"):
        validate(value)
    value = judgment()
    result(value, "N01")["status"] = "PARTIAL"
    with pytest.raises(ValueError):
        validate(value)


def test_commission_fail_requires_exact_candidate_quote():
    validate(fail(judgment()))
    with pytest.raises(ValueError, match="quote the response exactly"):
        validate(fail(judgment(), quote="fabricated quote"))
    value = fail(judgment())
    result(value, "case:hidden_insight/wife_evening_calls")["evidence"] = []
    with pytest.raises(ValueError, match="exact candidate quote"):
        validate(value)


def history_quote(value, quote, turn=2, check_id="N01", source="conversation_history"):
    result(value, check_id)["evidence"] = [{"source": source, "turn": turn, "quote": quote}]
    return value


def cited(value, check_id="N01"):
    return result(validate(value), check_id)["evidence"][0]


def test_evidence_quotes_tolerate_case_spacing_and_edge_punctuation():
    # Judges lowercase a sentence start or capitalize a mid-sentence quote; the words still match.
    validate(fail(judgment(), quote="phòng thứ hai hai vợ chồng anh"))
    validate(fail(judgment(), quote="  “Hai vợ chồng   anh dùng để làm việc ở nhà…”"))
    validate(fail(judgment(), quote=unicodedata.normalize("NFD", "Phòng thứ hai")))
    validate(history_quote(judgment(), "Anh dự định sử dụng phòng ngủ thứ hai như thế nào ạ?"))
    validate(history_quote(judgment(), "em gọi về mặt bằng căn hai phòng ngủ anh vừa tải."))


def test_evidence_quotes_not_in_the_source_are_still_rejected():
    with pytest.raises(ValueError, match="quote the response exactly"):
        validate(fail(judgment(), quote="Phòng thứ hai anh cho thuê"))
    with pytest.raises(ValueError, match="quote the response exactly"):
        validate(fail(judgment(), quote="…"))
    with pytest.raises(ValueError, match="quote the specified turn exactly"):
        validate(history_quote(judgment(), "Anh dự định bán căn hộ ngay tháng sau"))
    # Without the right turn, a quote found in several turns cannot be placed.
    with pytest.raises(ValueError, match="quote the specified turn exactly"):
        validate(history_quote(judgment(), "anh Khải", turn=None))


def test_history_quote_with_a_wrong_turn_or_source_is_moved_to_where_it_is():
    assert cited(history_quote(judgment(), "Alo, anh Khải nghe đây.", turn=2))["turn"] == 1
    assert cited(history_quote(judgment(), "phòng ngủ thứ hai như thế nào", turn=None))["turn"] == 2
    from_response = cited(history_quote(judgment(), "dùng để làm việc ở nhà", turn=1))
    assert (from_response["source"], from_response["turn"]) == ("candidate_response", None)


def test_scenario_evidence_must_quote_what_the_judge_received():
    quote = "Hai vợ chồng cần một căn có thể vừa ở vừa làm việc tại nhà."  # private_background
    assert cited(history_quote(judgment(), quote, turn=None, source="scenario"))["source"] == "scenario"
    assert cited(history_quote(judgment(), "Hướng hồ nội khu", turn=None, source="scenario"))["turn"] is None
    # Judges label scenario facts as history; the quote is kept under its real source.
    relabelled = cited(history_quote(judgment(), quote, turn=1))
    assert (relabelled["source"], relabelled["turn"]) == ("scenario", None)
    with pytest.raises(ValueError, match="quote the case or offering exactly"):
        validate(history_quote(judgment(), "Hai vợ chồng định mua để cho thuê", turn=None, source="scenario"))
    # The reference response is hidden from the judge, so it is not citable scenario text.
    hidden = DATASET["cases"][0]["reference_response"]
    with pytest.raises(ValueError, match="quote the case or offering exactly"):
        validate(history_quote(judgment(), hidden, turn=None, source="scenario"))
    with pytest.raises(ValueError, match="quote the specified turn exactly"):
        validate(history_quote(judgment(), hidden, turn=None))


def test_fail_type_is_inferred_from_evidence_when_omitted():
    value = fail(judgment())
    result(value, "case:hidden_insight/wife_evening_calls")["failure_type"] = None
    assert result(validate(value), "case:hidden_insight/wife_evening_calls")["failure_type"] == "commission"
    value = omission(judgment())
    result(value, "case:hidden_insight/shared_home_office")["failure_type"] = None
    assert result(validate(value), "case:hidden_insight/shared_home_office")["failure_type"] == "omission"
    value = fail(judgment())
    result(value, "case:hidden_insight/wife_evening_calls").update(failure_type=None, evidence=[])
    with pytest.raises(ValueError, match="quote or a salesperson trigger"):
        validate(value)


def test_omission_fail_uses_seller_trigger_without_invented_quote():
    validate(omission(judgment()))
    with pytest.raises(ValueError, match="salesperson trigger"):
        validate(omission(judgment(), turn=1))


def test_failure_fields_on_passing_checks_are_cleared():
    value = judgment()
    result(value, "N01").update(failure_type="omission", trigger_turn=2)
    cleared = result(validate(value), "N01")
    assert cleared["failure_type"] is None and cleared["trigger_turn"] is None


def test_any_policy_ambiguity_needs_review_whatever_it_references():
    value = judgment()
    value["policy_ambiguities"] = [{"description": "Conflict.", "references": ["case:objection/not_listed"]}]
    assert aggregate([validate(value)], CHECKLIST)["verdict"] == "manual_review"


def args(tmp_path, **changes):
    values = {
        "dataset": runner.DEFAULT_DATASET,
        "rubric": None,
        "runs_dir": tmp_path,
        "case_id": [DATASET["cases"][0]["case_id"]],
        "judge_runs": 1,
        "samples": None,
        "candidate_model": None,
        "judge_model": None,
        "candidate_parameters": None,
        "judge_parameters": None,
        "judge_format": "json_object",
        "responses": None,
        "base_url": "https://offline.invalid/v1",
        "judge_base_url": None,
        "timeout": 1,
        "concurrency": 1,
        "dry_run": False,
        "validate_only": False,
        "resume": None,
    }
    values.update(changes)
    return Namespace(**values)


def fake_provider(monkeypatch, responses, requests=None):
    bodies = []
    replies = iter(responses)
    # The real client, even when an earlier fake_provider call in this test patched it.
    client_class = getattr(runner.httpx.Client, "real_client", runner.httpx.Client)

    def handler(request):
        bodies.append(json.loads(request.content))
        if requests is not None:
            requests.append((request.url.host, request.headers["Authorization"]))
        item = next(replies)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, int):
            return httpx.Response(item)
        return httpx.Response(
            200,
            json={
                "id": "offline",
                "model": "resolved-model",
                "usage": {"total_tokens": 10},
                "choices": [{"finish_reason": "stop", "message": {"content": item}}],
            },
        )

    def client(**kwargs):
        return client_class(transport=httpx.MockTransport(handler), **kwargs)

    client.real_client = client_class
    monkeypatch.setattr(runner.httpx, "Client", client)
    monkeypatch.setenv("VOICE_AGENT_LLM_API_KEY", "TEST_KEY_NEVER_SAVE")
    return bodies


def test_full_flow_and_model_defaults_without_network(tmp_path, monkeypatch):
    bodies = fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())])
    directory, code = runner.run(args(tmp_path))
    assert code == 0
    assert bodies[0]["model"] == DATASET["default_models"]["buyer_response_generator"]
    assert bodies[1]["model"] == JUDGE_MODEL
    results = runner.read_json(directory / "results.json")
    assert results["results"][0]["evaluation"]["verdict"] == "pass"
    assert results["summary"]["evaluated_cases"] == 1
    assert results["summary"]["strata"]["tags:selective_disclosure"]["pass"] == 1
    manifest = runner.read_json(directory / "manifest.json")
    assert manifest["dataset"]["snapshot"]["dataset_id"] == DATASET["dataset_id"]
    assert manifest["prompt"]["version"] == "buyer-v1"
    for path in directory.glob("*.json"):
        assert "TEST_KEY_NEVER_SAVE" not in path.read_text()


def test_judge_defaults_to_buyer_endpoint_and_key(tmp_path, monkeypatch):
    requests = []
    fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())], requests)
    directory, _ = runner.run(args(tmp_path))
    assert requests == [("offline.invalid", "Bearer TEST_KEY_NEVER_SAVE")] * 2
    transport = runner.read_json(directory / "manifest.json")["transport"]
    assert (
        transport["candidate_endpoint"] == transport["judge_endpoint"] == "https://offline.invalid/v1/chat/completions"
    )


def test_judge_uses_its_own_endpoint_and_key(tmp_path, monkeypatch):
    requests = []
    fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())], requests)
    monkeypatch.setenv("EVAL_JUDGE_LLM_BASE_URL", "https://judge.invalid/v1")
    monkeypatch.setenv("EVAL_JUDGE_LLM_API_KEY", "JUDGE_KEY_NEVER_SAVE")
    directory, code = runner.run(args(tmp_path))
    assert code == 0
    assert requests == [
        ("offline.invalid", "Bearer TEST_KEY_NEVER_SAVE"),
        ("judge.invalid", "Bearer JUDGE_KEY_NEVER_SAVE"),
    ]
    assert runner.read_json(directory / "manifest.json")["transport"]["judge_endpoint"] == (
        "https://judge.invalid/v1/chat/completions"
    )
    for path in directory.glob("*.json"):
        assert "JUDGE_KEY_NEVER_SAVE" not in path.read_text()


def test_judge_base_url_flag_overrides_the_environment(tmp_path, monkeypatch):
    requests = []
    bodies = fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())], requests)
    monkeypatch.setenv("EVAL_JUDGE_LLM_BASE_URL", "https://judge.invalid/v1")
    monkeypatch.setenv("EVAL_JUDGE_LLM_API_KEY", "JUDGE_KEY_NEVER_SAVE")
    directory, _ = runner.run(args(tmp_path, judge_base_url="https://judge.invalid/v2"))
    assert requests[1] == ("judge.invalid", "Bearer JUDGE_KEY_NEVER_SAVE")
    assert bodies[1]["model"] == JUDGE_MODEL
    assert runner.read_json(directory / "manifest.json")["transport"]["judge_endpoint"] == (
        "https://judge.invalid/v2/chat/completions"
    )


def test_judge_settings_are_never_sent_to_an_overridden_judge_host(tmp_path, monkeypatch):
    requests = []
    bodies = fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())], requests)
    monkeypatch.setenv("EVAL_JUDGE_LLM_BASE_URL", "https://judge.invalid/v1")
    monkeypatch.setenv("EVAL_JUDGE_LLM_API_KEY", "JUDGE_KEY_NEVER_SAVE")
    with pytest.raises(ValueError, match="Pass --judge-model for judge host other-judge.invalid"):
        runner.run(args(tmp_path, dry_run=True, judge_base_url="https://other-judge.invalid/v1"))
    other_judge = args(tmp_path, judge_base_url="https://other-judge.invalid/v1", judge_model="other-model")
    with pytest.raises(ValueError, match="No API key for judge host other-judge.invalid"):
        runner.run(other_judge)
    assert requests == []
    # Pointing the judge back at the buyer host reuses the buyer's model and key.
    runner.run(args(tmp_path, judge_base_url="https://offline.invalid/v1"))
    assert requests == [("offline.invalid", "Bearer TEST_KEY_NEVER_SAVE")] * 2
    assert bodies[1]["model"] == "openai/gpt-6-luna"


def test_judge_model_flag_overrides_the_environment(tmp_path, monkeypatch):
    bodies = fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())])
    runner.run(args(tmp_path, judge_model="flag-judge-model"))
    assert bodies[1]["model"] == "flag-judge-model"


def test_judge_model_falls_back_to_the_voice_agent_model_on_the_same_host(tmp_path, monkeypatch):
    monkeypatch.delenv("EVAL_JUDGE_LLM_MODEL")
    directory, _ = runner.run(args(tmp_path, dry_run=True))
    assert runner.read_json(directory / "manifest.json")["judge"]["model"] == "openai/gpt-6-luna"
    monkeypatch.setenv("VOICE_AGENT_LLM_MODEL", "voice-agent-model")
    directory, _ = runner.run(args(tmp_path, dry_run=True))
    assert runner.read_json(directory / "manifest.json")["judge"]["model"] == "voice-agent-model"
    with pytest.raises(ValueError, match="Pass --judge-model for judge host judge.invalid"):
        runner.run(args(tmp_path, dry_run=True, judge_base_url="https://judge.invalid/v1"))
    monkeypatch.setenv("EVAL_JUDGE_LLM_BASE_URL", "https://judge.invalid/v1")
    with pytest.raises(ValueError, match="Set EVAL_JUDGE_LLM_MODEL"):
        runner.run(args(tmp_path, dry_run=True))


def test_buyer_key_is_never_sent_to_a_different_judge_host(tmp_path, monkeypatch):
    requests = []
    fake_provider(monkeypatch, [], requests)
    monkeypatch.setenv("EVAL_JUDGE_LLM_BASE_URL", "https://judge.invalid/v1")
    with pytest.raises(ValueError, match="Set EVAL_JUDGE_LLM_API_KEY"):
        runner.run(args(tmp_path))
    assert requests == []


@pytest.mark.parametrize("reply", [503, "{broken JSON", json.dumps({"confidence": "high"})])
def test_provider_and_invalid_judge_errors_preserve_generation(tmp_path, monkeypatch, reply):
    fake_provider(monkeypatch, [RESPONSE, reply])
    directory, code = runner.run(args(tmp_path))
    assert code == 1
    results = runner.read_json(directory / "results.json")
    assert results["status"] == "partial"
    assert results["results"][0]["buyer_response"] == RESPONSE
    assert results["results"][0]["evaluation"] is None
    assert results["summary"]["error_samples"] == 1
    assert results["summary"]["pass_rate"] is None


def resume_args(tmp_path, directory, **changes):
    # A resumed run takes its data and judging settings from the run itself.
    fixed = dict(dataset=None, case_id=None, judge_runs=None, judge_format=None)
    return args(tmp_path, resume=directory, **fixed, **changes)


def test_quota_error_stops_new_samples_and_resume_finishes_them_elsewhere(tmp_path, monkeypatch):
    fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment()), 429])
    directory, code = runner.run(args(tmp_path, samples=3))
    assert code == 1
    results = runner.read_json(directory / "results.json")
    assert results["status"] == "interrupted"
    assert [row["status"] for row in results["results"]] == ["evaluated", "error", "planned"]
    assert results["results"][1]["error_kind"] == "provider"
    assert "HTTP 429 on https://offline.invalid" in runner.read_json(directory / "manifest.json")["stop_reason"]

    requests = []
    bodies = fake_provider(monkeypatch, [RESPONSE, json.dumps(judgment())] * 2, requests)
    resumed = resume_args(tmp_path, directory, base_url="https://second.invalid/v1", candidate_model="renamed")
    same, code = runner.run(resumed)
    assert same == directory and code == 0
    assert [host for host, _ in requests] == ["second.invalid"] * 4
    assert [body["model"] for body in bodies] == ["renamed", JUDGE_MODEL] * 2
    results = runner.read_json(directory / "results.json")
    assert results["status"] == "complete"
    assert [row["status"] for row in results["results"]] == ["evaluated"] * 3
    assert "error" not in results["results"][1]
    manifest = runner.read_json(directory / "manifest.json")
    assert "stop_reason" not in manifest
    assert manifest["transport"]["candidate_endpoint"] == "https://offline.invalid/v1/chat/completions"
    (entry,) = manifest["resumes"]
    assert entry["samples"] == 2 and entry["candidate_model"] == "renamed"
    assert entry["candidate_endpoint"] == "https://second.invalid/v1/chat/completions"
    calls = runner.read_json(directory / "requests.json")["calls"]
    assert [call["endpoint"].split("/")[2] for call in calls] == ["offline.invalid"] * 3 + ["second.invalid"] * 4


def test_unreachable_endpoint_stops_the_run_instead_of_timing_out_every_sample(tmp_path, monkeypatch):
    bodies = fake_provider(monkeypatch, [httpx.ConnectTimeout("offline")])
    directory, code = runner.run(args(tmp_path, samples=3))
    assert code == 1 and len(bodies) == 1
    results = runner.read_json(directory / "results.json")
    assert [row["status"] for row in results["results"]] == ["error", "planned", "planned"]
    assert sum(runner.resumable(row) for row in results["results"]) == 3
    manifest = runner.read_json(directory / "manifest.json")
    assert "ConnectTimeout" in manifest["stop_reason"]
    assert manifest["transport"]["connect_timeout_seconds"] == 1  # capped by --timeout 1


def test_resume_rejudges_a_kept_response_after_a_judge_provider_error(tmp_path, monkeypatch):
    fake_provider(monkeypatch, [RESPONSE, 402])
    directory, code = runner.run(args(tmp_path))
    assert code == 1
    bodies = fake_provider(monkeypatch, [json.dumps(judgment())])
    _, code = runner.run(resume_args(tmp_path, directory))
    assert code == 0 and len(bodies) == 1 and "response_format" in bodies[0]
    row = runner.read_json(directory / "results.json")["results"][0]
    assert row["buyer_response"] == RESPONSE and row["evaluation"]["verdict"] == "pass"


def test_resume_does_not_retry_invalid_judgments_or_change_run_settings(tmp_path, monkeypatch):
    fake_provider(monkeypatch, [RESPONSE, "{broken JSON"])
    directory, code = runner.run(args(tmp_path))
    assert code == 1
    assert runner.read_json(directory / "results.json")["results"][0]["error_kind"] == "invalid_output"
    bodies = fake_provider(monkeypatch, [])
    _, code = runner.run(resume_args(tmp_path, directory))
    assert code == 1 and bodies == []
    with pytest.raises(ValueError, match="keeps its own data, samples and judging settings; remove --samples"):
        runner.run(resume_args(tmp_path, directory, samples=2))


def test_dry_run_no_model_calls_and_no_overwrite(tmp_path, monkeypatch):
    monkeypatch.setattr(runner.httpx, "Client", lambda **kwargs: pytest.fail("Dry run contacted provider"))
    first, _ = runner.run(args(tmp_path, dry_run=True))
    second, _ = runner.run(args(tmp_path, dry_run=True))
    assert first != second
    assert runner.read_json(first / "requests.json")["calls"] == []
    assert runner.read_json(first / "results.json")["summary"]["evaluated_cases"] == 0


def test_regrade_does_not_generate_or_misattribute_the_response(tmp_path, monkeypatch):
    path = tmp_path / "responses.json"
    path.write_text(json.dumps([{"case_id": DATASET["cases"][0]["case_id"], "buyer_response": RESPONSE}]))
    bodies = fake_provider(monkeypatch, [json.dumps(judgment())])
    directory, code = runner.run(args(tmp_path / "runs", responses=path))
    assert code == 0 and len(bodies) == 1
    manifest = runner.read_json(directory / "manifest.json")
    assert manifest["mode"] == "regrade"
    assert manifest["candidate"]["model"] is None
    assert manifest["response_source"]["sha256"]
    assert runner.read_json(directory / "requests.json")["cases"][0]["generation_request"] is None


def test_even_judge_count_and_reserved_parameter_keys_are_rejected(tmp_path):
    with pytest.raises(ValueError, match="odd number"):
        runner.run(args(tmp_path, judge_runs=2))
    path = tmp_path / "parameters.json"
    path.write_text(json.dumps({"messages": []}))
    with pytest.raises(ValueError, match="Unsupported model parameters"):
        runner.parameters(path)


def test_pass_estimates_are_unbiased_combinatorial_estimators():
    assert runner.pass_estimates(passes=2, samples=3, k=1) == pytest.approx((2 / 3, 2 / 3))
    assert runner.pass_estimates(passes=2, samples=3, k=2) == pytest.approx((1, 1 / 3))
    assert runner.pass_estimates(passes=2, samples=3, k=3) == pytest.approx((1, 0))
    assert runner.pass_estimates(passes=0, samples=5, k=5) == (0, 0)
    assert runner.pass_estimates(passes=5, samples=5, k=5) == (1, 1)


def test_samples_are_generated_and_judged_independently(tmp_path, monkeypatch):
    replies = [RESPONSE, json.dumps(judgment()), RESPONSE, json.dumps(fail(judgment())), RESPONSE]
    bodies = fake_provider(monkeypatch, [*replies, json.dumps(judgment())])
    directory, code = runner.run(args(tmp_path, samples=3))
    assert code == 0 and len(bodies) == 6
    assert bodies[0] == bodies[2] == bodies[4]  # identical generation requests
    results = runner.read_json(directory / "results.json")
    assert [(row["sample"], row["evaluation"]["verdict"]) for row in results["results"]] == [
        (1, "pass"),
        (2, "fail"),
        (3, "pass"),
    ]
    summary = results["summary"]
    assert (summary["total_cases"], summary["total_samples"], summary["evaluated_samples"]) == (1, 3, 3)
    assert summary["pass_rate"] == pytest.approx(2 / 3, abs=1e-4)
    reliability = summary["reliability"]
    case_id = DATASET["cases"][0]["case_id"]
    assert reliability["per_case"] == {case_id: {"samples": 3, "passes": 2}}
    assert [reliability["pass_hat_k"][k]["value"] for k in ("1", "2", "3")] == [0.6667, 0.3333, 0.0]
    assert [reliability["pass_at_k"][k]["value"] for k in ("1", "2", "3")] == [0.6667, 1.0, 1.0]
    assert reliability["strata"]["tags:selective_disclosure"]["pass_hat_k"]["3"] == 0.0
    assert runner.read_json(directory / "manifest.json")["candidate"]["samples_per_case"] == 3
    calls = runner.read_json(directory / "requests.json")["calls"]
    assert [(call["phase"], call["sample"]) for call in calls] == [
        ("generation", 1),
        ("judge", 1),
        ("generation", 2),
        ("judge", 2),
        ("generation", 3),
        ("judge", 3),
    ]


def test_manual_review_does_not_count_as_a_pass():
    row = {"case_id": "c", "status": "evaluated", "strata": {}}
    rows = [
        {**row, "evaluation": {"verdict": "pass"}},
        {**row, "evaluation": {"verdict": "manual_review"}},
    ]
    assert runner.reliability(rows)["per_case"] == {"c": {"samples": 2, "passes": 1}}


def test_regrade_keeps_supplied_samples_and_rejects_the_samples_flag(tmp_path, monkeypatch):
    case_id = DATASET["cases"][0]["case_id"]
    path = tmp_path / "responses.json"
    path.write_text(json.dumps([{"case_id": case_id, "sample": n, "buyer_response": RESPONSE} for n in (1, 2)]))
    bodies = fake_provider(monkeypatch, [json.dumps(judgment()), json.dumps(fail(judgment()))])
    directory, code = runner.run(args(tmp_path / "runs", responses=path))
    assert code == 0 and len(bodies) == 2
    reliability = runner.read_json(directory / "results.json")["summary"]["reliability"]
    assert reliability["per_case"] == {case_id: {"samples": 2, "passes": 1}}
    with pytest.raises(ValueError, match="--samples generates responses"):
        runner.run(args(tmp_path / "runs", responses=path, samples=2))
    path.write_text(json.dumps([{"case_id": case_id, "sample": 2, "buyer_response": RESPONSE}]))
    with pytest.raises(ValueError, match="numbered 1..n"):
        runner.run(args(tmp_path / "runs", responses=path))


def test_concurrent_samples_keep_their_own_calls_and_errors(tmp_path, monkeypatch):
    # Replies depend on the request, not on arrival order, so threads can interleave.
    lock = threading.Lock()
    judged = []
    client_class = httpx.Client

    def handler(request):
        body = json.loads(request.content)
        if "response_format" not in body:
            content = RESPONSE
        else:
            with lock:
                judged.append(1)
                count = len(judged)
            if count == 3:
                return httpx.Response(503)  # exactly one sample's judge call fails
            content = json.dumps(judgment())
        return httpx.Response(
            200, json={"id": "offline", "choices": [{"finish_reason": "stop", "message": {"content": content}}]}
        )

    monkeypatch.setattr(
        runner.httpx, "Client", lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs)
    )
    monkeypatch.setenv("VOICE_AGENT_LLM_API_KEY", "TEST_KEY_NEVER_SAVE")
    directory, code = runner.run(args(tmp_path, samples=6, concurrency=4))
    assert code == 1
    rows = runner.read_json(directory / "results.json")["results"]
    assert [row["sample"] for row in rows] == [1, 2, 3, 4, 5, 6]
    assert sorted(row["status"] for row in rows) == ["error"] + ["evaluated"] * 5
    calls = runner.read_json(directory / "requests.json")["calls"]
    assert len(calls) == 12
    for row in rows:
        own = [call for call in calls if call["sample"] == row["sample"]]
        assert [call["phase"] for call in own] == ["generation", "judge"]
        assert all(call["http_status"] in {200, 503} for call in own)
        assert ("error" in own[1]) == (row["status"] == "error") and "error" not in own[0]
    manifest = runner.read_json(directory / "manifest.json")
    assert manifest["transport"]["concurrency"] == 4 and manifest["status"] == "partial"


def test_concurrency_must_be_positive(tmp_path):
    with pytest.raises(ValueError, match="--concurrency"):
        runner.run(args(tmp_path, concurrency=0, dry_run=True))
