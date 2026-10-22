import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from openai import APIConnectionError, APIStatusError
from openai.types.chat import ChatCompletion
from pydantic import SecretStr, ValidationError

from src.salescoach_voice import evaluation
from src.salescoach_voice.api import router
from src.salescoach_voice.evaluation import EvaluationError, Evaluator
from src.salescoach_voice.evaluation_output import (
    EvaluationOutput,
    GeneratedCriticalCommission,
    GeneratedCriticalOmission,
    GeneratedEvaluationOutput,
    GeneratedMissedFinding,
    GeneratedPerformedFinding,
)
from src.salescoach_voice.models import EvaluationRequest
from src.salescoach_voice.runtime import get_runtime


def evidence(number, quote=None):
    item = {"turnNumber": number, "observation": "Observed in the transcript"}
    if quote is not None:
        item["quote"] = quote
    return item


def missed_finding():
    return {
        "id": "missed_budget",
        "kind": "opportunity_missed",
        "behaviorId": "ask_budget",
        "rationale": "The buyer invited budget discovery, but the learner changed the subject",
        "opportunityEvidence": [evidence(7)],
        "responseEvidence": [evidence(9)],
        "contextEvidence": [],
    }


@pytest.fixture
def request_data():
    return EvaluationRequest(
        practice={"id": "practice"},
        agentConfig={"hiddenInsights": [{"key": "budget"}], "objections": [{"key": "price"}]},
        competencies=[
            {
                "code": "discovery",
                "rubric": {
                    "description": "Discover the buyer's budget accurately",
                    "behaviors": [{"id": "ask_budget", "description": "Ask the buyer about their budget"}],
                    "levels": [
                        {"id": "unmet", "label": "Unmet", "score": 0, "requiredBehaviorIds": []},
                        {"id": "met", "label": "Met", "score": 100, "requiredBehaviorIds": ["ask_budget"]},
                    ],
                    "criticalErrors": [
                        {"id": "false_budget", "description": "Invent the buyer's budget", "scoreCap": 20}
                    ],
                },
            }
        ],
        turns=[{"sequence": 1, "speaker": "user", "text": "What is your budget?"}],
    )


@pytest.fixture
def valid_output():
    return {
        "insightDiscovery": {"budget": False},
        "objectiveOutcome": None,
        "objectiveEvidence": [],
        "objectionOutcomes": [{"key": "price", "status": "not_raised", "evidence": []}],
        "competencyAssessments": [
            {
                "competencyCode": "discovery",
                "findings": [
                    {
                        "id": "asked_budget",
                        "kind": "demonstrated",
                        "behaviorId": "ask_budget",
                        "rationale": "The learner asked about budget",
                        "behaviorEvidence": [evidence(1)],
                        "contextEvidence": [],
                    }
                ],
            }
        ],
    }


@pytest.fixture(params=["demonstrated", "attempted", "opportunity_missed", "critical_commission", "critical_omission"])
def generated_finding(request, valid_output):
    variant = request.param
    if variant in {"opportunity_missed", "critical_omission"}:
        finding = missed_finding()
        model = GeneratedMissedFinding if variant == "opportunity_missed" else GeneratedCriticalOmission
    else:
        finding = copy.deepcopy(valid_output["competencyAssessments"][0]["findings"][0])
        finding["kind"] = variant if variant in {"demonstrated", "attempted"} else "critical_error"
        finding["behaviorEvidence"] = [evidence(9)]
        model = GeneratedCriticalCommission if variant == "critical_commission" else GeneratedPerformedFinding
    if variant.startswith("critical_"):
        del finding["behaviorId"]
        finding.update(kind="critical_error", criticalErrorId="false_budget")
    finding["contextEvidence"] = [evidence(11)]
    return finding, model


def test_union_rejects_each_missing_required_collection(valid_output, generated_finding):
    finding, _ = generated_finding
    for collection in (name for name in finding if name.endswith("Evidence")):
        invalid = copy.deepcopy(valid_output)
        invalid["competencyAssessments"][0]["findings"] = [copy.deepcopy(finding)]
        del invalid["competencyAssessments"][0]["findings"][0][collection]
        with pytest.raises(ValidationError):
            GeneratedEvaluationOutput.model_validate(invalid)


def test_union_requires_nonempty_primary_evidence_collections(valid_output, generated_finding):
    finding, _ = generated_finding
    for collection in (name for name in finding if name.endswith("Evidence") and name != "contextEvidence"):
        invalid = copy.deepcopy(valid_output)
        invalid["competencyAssessments"][0]["findings"] = [copy.deepcopy(finding)]
        invalid["competencyAssessments"][0]["findings"][0][collection] = []
        with pytest.raises(ValidationError):
            GeneratedEvaluationOutput.model_validate(invalid)


def test_union_rejects_incompatible_extra_collections_and_rule_ids(valid_output, generated_finding):
    finding, _ = generated_finding
    extras = {"behaviorEvidence", "opportunityEvidence", "responseEvidence"} - finding.keys()
    extras.add("behaviorId" if "criticalErrorId" in finding else "criticalErrorId")
    extras.add("evidence")
    for field in extras:
        invalid = copy.deepcopy(valid_output)
        invalid["competencyAssessments"][0]["findings"] = [copy.deepcopy(finding)]
        invalid["competencyAssessments"][0]["findings"][0][field] = (
            "ask_budget" if field == "behaviorId" else "false_budget" if field == "criticalErrorId" else [evidence(9)]
        )
        with pytest.raises(ValidationError):
            GeneratedEvaluationOutput.model_validate(invalid)


def test_union_rejects_incompatible_kind_and_collections(valid_output, generated_finding):
    finding, _ = generated_finding
    invalid = copy.deepcopy(valid_output)
    incompatible = copy.deepcopy(finding)
    incompatible["kind"] = (
        "demonstrated" if "opportunityEvidence" in finding or "criticalErrorId" in finding else "opportunity_missed"
    )
    invalid["competencyAssessments"][0]["findings"] = [incompatible]
    with pytest.raises(ValidationError):
        GeneratedEvaluationOutput.model_validate(invalid)


def test_generated_schema_makes_kind_collection_combinations_unrepresentable():
    schema = GeneratedEvaluationOutput.model_json_schema()
    finding_items = schema["$defs"]["GeneratedCompetencyAssessment"]["properties"]["findings"]["items"]
    expected = {
        "GeneratedPerformedFinding": (
            {"behaviorId", "behaviorEvidence", "contextEvidence"},
            ["demonstrated", "attempted"],
        ),
        "GeneratedMissedFinding": (
            {"behaviorId", "opportunityEvidence", "responseEvidence", "contextEvidence"},
            ["opportunity_missed"],
        ),
        "GeneratedCriticalCommission": ({"criticalErrorId", "behaviorEvidence", "contextEvidence"}, ["critical_error"]),
        "GeneratedCriticalOmission": (
            {"criticalErrorId", "opportunityEvidence", "responseEvidence", "contextEvidence"},
            ["critical_error"],
        ),
    }
    assert set(finding_items) == {"anyOf"}
    assert {branch["$ref"].rsplit("/", 1)[-1] for branch in finding_items["anyOf"]} == expected.keys()
    assert "oneOf" not in json.dumps(schema)
    assert "discriminator" not in json.dumps(schema)
    for name, (variant_fields, kinds) in expected.items():
        branch = schema["$defs"][name]
        fields = branch["properties"]
        assert set(fields) == {"id", "kind", "rationale"} | variant_fields
        assert set(branch["required"]) == set(fields)
        assert branch["additionalProperties"] is False
        assert fields["kind"].get("enum", [fields["kind"].get("const")]) == kinds
        for collection in variant_fields - {"behaviorId", "criticalErrorId"}:
            assert fields[collection]["type"] == "array"
            if collection != "contextEvidence":
                assert fields[collection]["minItems"] == 1
    assert set(schema["$defs"]["GeneratedEvaluationEvidence"]["properties"]) == {"turnNumber", "observation"}


@pytest.mark.asyncio
async def test_valid_union_variants_normalize_to_unchanged_wire_contract(
    evaluator, request_data, valid_output, generated_finding
):
    finding, model = generated_finding
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Let's discuss the property."},
        {"sequence": 11, "speaker": "assistant", "text": "Which fees are included?"},
    ]
    valid_output["competencyAssessments"][0]["findings"] = [finding]
    parsed = GeneratedEvaluationOutput.model_validate(valid_output)
    assert isinstance(parsed.competencyAssessments[0].findings[0], model)
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    accepted = result["competencyAssessments"][0]["findings"][0]
    omission = "opportunityEvidence" in finding
    rule_field = "criticalErrorId" if "criticalErrorId" in finding else "behaviorId"
    assert accepted == {
        "id": finding["id"],
        "kind": finding["kind"],
        rule_field: finding[rule_field],
        "rationale": finding["rationale"],
        "evidence": [
            evidence(number, next(turn["text"] for turn in request_data.turns if turn["sequence"] == number))
            for number in ([7, 9, 11] if omission else [9, 11])
        ],
        "opportunityTurnNumbers": [7] if omission else [],
        "responseTurnNumbers": [9] if omission else [],
    }
    assert evaluator._client.chat.completions.create.await_count == 1
    assert result["competencyAssessments"][0]["assessmentStatus"] == (
        "opportunity_missed" if finding["kind"] == "opportunity_missed" else "observed"
    )


def completion(content, *, finish_reason="stop", refusal=None, usage=None):
    return ChatCompletion(
        id="evaluation-response",
        created=0,
        model="evaluation-model",
        object="chat.completion",
        usage=usage,
        choices=[
            {
                "index": 0,
                "finish_reason": finish_reason,
                "message": {"role": "assistant", "content": content, "refusal": refusal},
            }
        ],
    )


@pytest.fixture
def evaluator():
    result = Evaluator(
        SimpleNamespace(
            voice_agent_llm_api_key=SecretStr("test-key"),
            voice_agent_llm_base_url="https://openrouter.ai/api/v1",
            voice_evaluation_llm_timeout_seconds=20,
            voice_evaluation_llm_model="evaluation-model",
            voice_agent_llm_model="voice-model",
        )
    )
    result._client.chat.completions.create = AsyncMock()
    return result


@pytest.mark.asyncio
async def test_findings_only_output_preserves_evidence_and_omits_nullable_rule_ids(
    evaluator, request_data, valid_output
):
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert set(result) == {
        "discoveredInsightKeys",
        "missedInsightKeys",
        "objectiveEvidence",
        "objectionOutcomes",
        "competencyAssessments",
    }
    assessment = result["competencyAssessments"][0]
    assert set(assessment) == {"competencyCode", "assessmentStatus", "findings"}
    finding = assessment["findings"][0]
    assert finding["behaviorId"] == "ask_budget"
    assert "criticalErrorId" not in finding
    assert finding["evidence"] == [evidence(1, "What is your budget?")]
    assert finding["opportunityTurnNumbers"] == []
    assert finding["responseTurnNumbers"] == []
    assert result["objectionOutcomes"][0]["raised"] is False
    assert "handling" not in result["objectionOutcomes"][0]
    assert create.await_count == 1
    schema = create.call_args.kwargs["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["competencyAssessments"]["items"] == {
        "anyOf": [{"$ref": "#/$defs/GeneratedCompetencyAssessment_0"}]
    }
    assessment_fields = schema["$defs"]["GeneratedCompetencyAssessment_0"]["properties"]
    assert set(assessment_fields) == {"competencyCode", "findings"}
    for obj in [schema, *schema["$defs"].values()]:
        assert obj["additionalProperties"] is False
        assert set(obj["required"]) == set(obj["properties"])
    for array, definition, key, expected in [
        ("objectionOutcomes", "GeneratedUnraisedObjectionOutcome", "key", "price"),
        ("objectionOutcomes", "GeneratedRaisedObjectionOutcome", "key", "price"),
        ("competencyAssessments", "GeneratedCompetencyAssessment_0", "competencyCode", "discovery"),
    ]:
        assert schema["properties"][array]["minItems"] == schema["properties"][array]["maxItems"] == 1
        assert schema["$defs"][definition]["properties"][key]["enum"] == [expected]
    assert schema["$defs"]["GeneratedEvaluationEvidence"]["properties"]["turnNumber"]["type"] == "integer"
    assert "oneOf" not in json.dumps(schema)
    assert "discriminator" not in json.dumps(schema)
    fields = schema["$defs"]["GeneratedPerformedFinding_0"]["properties"]
    assert fields["kind"]["enum"] == ["demonstrated", "attempted"]
    assert set(fields) == {"id", "kind", "behaviorId", "rationale", "behaviorEvidence", "contextEvidence"}
    assert fields["behaviorEvidence"]["minItems"] == 1
    assert fields["behaviorId"]["enum"] == ["ask_budget"]
    assert schema["$defs"]["GeneratedCriticalCommission_0"]["properties"]["criticalErrorId"]["enum"] == ["false_budget"]
    finding_variants = schema["$defs"]["GeneratedCompetencyAssessment_0"]["properties"]["findings"]["items"]["anyOf"]
    assert {variant["$ref"].rsplit("/", 1)[-1] for variant in finding_variants} == {
        "GeneratedPerformedFinding_0",
        "GeneratedCriticalCommission_0",
    }
    # Unscoped variants would let the model bypass the rubric enums.
    assert (
        not {
            "GeneratedCompetencyAssessment",
            "GeneratedPerformedFinding",
            "GeneratedMissedFinding",
            "GeneratedCriticalCommission",
            "GeneratedCriticalOmission",
        }
        & schema["$defs"].keys()
    )


@pytest.mark.asyncio
async def test_generated_schema_excludes_terminal_opportunity_and_nonlearner_responses(
    evaluator, request_data, valid_output
):
    request_data.turns = [
        {"sequence": 9, "speaker": "assistant", "text": "Ask my budget."},
        {"sequence": 11, "speaker": "user", "text": "Let's discuss location instead."},
        {"sequence": 12, "speaker": "user", "text": "Seventy square metres."},
        {"sequence": 14, "speaker": "assistant", "text": "Which fees are included?"},
    ]
    finding = missed_finding()
    finding.update(opportunityEvidence=[evidence(9)], responseEvidence=[evidence(11)])
    valid_output["competencyAssessments"][0]["findings"] = [finding]
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    await evaluator.generate_practice(request_data)
    schema = create.call_args.kwargs["response_format"]["json_schema"]["schema"]
    definitions = schema["$defs"]
    variants = definitions["GeneratedCompetencyAssessment_0"]["properties"]["findings"]["items"]["anyOf"]
    assert {variant["$ref"].rsplit("/", 1)[-1] for variant in variants} == {
        "GeneratedPerformedFinding_0",
        "GeneratedMissedFinding_0",
        "GeneratedCriticalCommission_0",
        "GeneratedCriticalOmission_0",
    }
    for name in ("GeneratedMissedFinding_0", "GeneratedCriticalOmission_0"):
        fields = definitions[name]["properties"]
        assert "behaviorEvidence" not in fields
        assert "opportunityTurnNumbers" not in fields
        assert "responseTurnNumbers" not in fields
        assert fields["opportunityEvidence"]["minItems"] == 1
        assert fields["responseEvidence"]["minItems"] == 1
        for collection, expected in (
            ("opportunityEvidence", [9, 11]),
            ("responseEvidence", [11, 12]),
            ("contextEvidence", [9, 11, 12, 14]),
        ):
            item = fields[collection]["items"]
            item = definitions[item["$ref"].rsplit("/", 1)[-1]] if "$ref" in item else item
            assert item["properties"]["turnNumber"]["enum"] == expected
            assert "role" not in item["properties"]
    for name in ("GeneratedPerformedFinding_0", "GeneratedCriticalCommission_0"):
        fields = definitions[name]["properties"]
        assert "opportunityEvidence" not in fields
        assert "responseEvidence" not in fields
        item = fields["behaviorEvidence"]["items"]
        item = definitions[item["$ref"].rsplit("/", 1)[-1]] if "$ref" in item else item
        assert item["properties"]["turnNumber"]["enum"] == [11, 12]
    assert schema["$defs"]["GeneratedEvaluationEvidence"]["properties"]["turnNumber"]["enum"] == [9, 11, 12, 14]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "turns",
    [
        [],
        [{"sequence": 14, "speaker": "assistant", "text": "Which fees?"}],
        [{"sequence": 14, "speaker": "user", "text": "Hello."}],
    ],
)
async def test_schema_without_response_opportunities_excludes_omission_variants(
    evaluator, request_data, valid_output, turns
):
    request_data.turns = turns
    valid_output["competencyAssessments"][0]["findings"] = []
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["findings"] == []
    schema = create.call_args.kwargs["response_format"]["json_schema"]["schema"]
    findings = schema["$defs"]["GeneratedCompetencyAssessment_0"]["properties"]["findings"]
    variants = {variant["$ref"].rsplit("/", 1)[-1] for variant in findings["items"]["anyOf"]}
    if any(turn["speaker"] == "user" for turn in turns):
        assert variants == {"GeneratedPerformedFinding_0", "GeneratedCriticalCommission_0"}
        assert "maxItems" not in findings
    else:
        assert findings["maxItems"] == 0
        assert variants


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "turns",
    [
        [],
        [{"sequence": 5, "speaker": "assistant", "text": "I cannot talk. Goodbye."}],
        [{"sequence": 8, "speaker": "user", "text": "Hello?"}],
    ],
    ids=["empty_transcript", "buyer_hangs_up_at_opening", "insufficient_evidence"],
)
async def test_not_assessed_has_no_findings_or_model_score(evaluator, request_data, valid_output, turns):
    request_data.turns = turns
    valid_output["competencyAssessments"][0]["findings"] = []
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"] == [
        {"competencyCode": "discovery", "assessmentStatus": "not_assessed", "findings": []}
    ]


@pytest.mark.parametrize(
    "case",
    [
        "missing_status",
        "unknown_status",
        "observed_empty",
        "observed_missed",
        "missed_empty",
        "missed_performed",
        "not_assessed_with_findings",
    ],
)
def test_wire_contract_still_rejects_inconsistent_status(request_data, valid_output, case):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Let's discuss the property."},
    ]
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    finding["behaviorEvidence"] = [evidence(9)]
    if case == "observed_missed":
        valid_output["competencyAssessments"][0]["findings"] = [missed_finding()]
    output = GeneratedEvaluationOutput.model_validate(valid_output).to_evaluation_output(request_data).model_dump()
    assessment = output["competencyAssessments"][0]
    if case == "missing_status":
        del assessment["assessmentStatus"]
    elif case == "unknown_status":
        assessment["assessmentStatus"] = "unknown"
    elif case in {"observed_empty", "observed_missed"}:
        assessment["assessmentStatus"] = "observed"
    elif case in {"missed_empty", "missed_performed"}:
        assessment["assessmentStatus"] = "opportunity_missed"
    else:
        assessment["assessmentStatus"] = "not_assessed"
    if case in {"observed_empty", "missed_empty"}:
        assessment["findings"] = []
    with pytest.raises(ValidationError):
        EvaluationOutput.model_validate(output)


@pytest.mark.asyncio
@pytest.mark.parametrize("opportunity_speaker", ["assistant", "user"])
async def test_missed_opportunity_requires_actual_context_and_later_learner_response(
    evaluator, request_data, valid_output, opportunity_speaker
):
    request_data.turns = [
        {"sequence": 7, "speaker": opportunity_speaker, "text": "Let's discuss the budget."},
        {"sequence": 9, "speaker": "user", "text": "Let's schedule a visit instead."},
    ]
    finding = missed_finding()
    valid_output["competencyAssessments"][0]["findings"] = [finding]
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    accepted = result["competencyAssessments"][0]["findings"][0]
    assert accepted["opportunityTurnNumbers"] == [7]
    assert accepted["responseTurnNumbers"] == [9]
    assert [item["turnNumber"] for item in accepted["evidence"]] == [7, 9]


@pytest.mark.asyncio
async def test_collections_derive_deduplicated_references_and_preserve_context(evaluator, request_data, valid_output):
    request_data.turns = [
        {"sequence": 5, "speaker": "assistant", "text": "Can we discuss my spending limit?"},
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Let's schedule a visit."},
        {"sequence": 11, "speaker": "user", "text": "The apartment is nearby."},
        {"sequence": 14, "speaker": "assistant", "text": "Which fees are included?"},
    ]
    finding = missed_finding()
    finding["opportunityEvidence"] = [evidence(7), evidence(5), evidence(7)]
    finding["responseEvidence"] = [evidence(11), evidence(9), evidence(11)]
    finding["contextEvidence"] = [evidence(14), evidence(9)]
    valid_output["competencyAssessments"][0]["findings"] = [finding]
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    accepted = result["competencyAssessments"][0]["findings"][0]
    assert accepted["opportunityTurnNumbers"] == [7, 5]
    assert accepted["responseTurnNumbers"] == [11, 9]
    assert accepted["evidence"] == [
        evidence(number, next(turn["text"] for turn in request_data.turns if turn["sequence"] == number))
        for number in [7, 5, 7, 11, 9, 11, 14, 9]
    ]
    assert set(accepted) == {
        "id",
        "kind",
        "behaviorId",
        "rationale",
        "evidence",
        "opportunityTurnNumbers",
        "responseTurnNumbers",
    }
    assert "opportunityTurnNumbers" not in finding
    assert "responseTurnNumbers" not in finding
    assert create.await_count == 1


@pytest.mark.asyncio
async def test_terminal_buyer_opportunity_reports_actual_sequence_choices_and_retry_keeps_earlier_finding(
    evaluator, request_data, valid_output
):
    request_data.turns = [
        {"sequence": 9, "speaker": "assistant", "text": "Please ask about my budget."},
        {"sequence": 11, "speaker": "user", "text": "The apartment has a nice location."},
        {"sequence": 12, "speaker": "user", "text": "It is seventy square metres."},
        {"sequence": 14, "speaker": "assistant", "text": "Which project and fees are included?"},
    ]
    invalid = copy.deepcopy(valid_output)
    terminal = missed_finding()
    terminal.update(opportunityEvidence=[evidence(14)], responseEvidence=[evidence(12)])
    invalid["competencyAssessments"][0]["findings"] = [terminal]
    corrected = copy.deepcopy(valid_output)
    earlier = missed_finding()
    earlier.update(opportunityEvidence=[evidence(9)], responseEvidence=[evidence(11)])
    corrected["competencyAssessments"][0]["findings"] = [earlier]
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(corrected))]
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["findings"][0]["opportunityTurnNumbers"] == [9]
    assert result["competencyAssessments"][0]["findings"][0]["responseTurnNumbers"] == [11]
    correction = create.call_args.kwargs["messages"][-1]["content"]
    assert "opportunityTurnNumbers=[14]" in correction
    assert "invalid response sequences=[12]" in correction
    assert "later learner sequences=[]" in correction
    assert "remove the omission finding" in correction


@pytest.mark.asyncio
async def test_same_turn_cannot_be_its_own_omission_response(evaluator, request_data, valid_output):
    invalid = copy.deepcopy(valid_output)
    finding = missed_finding()
    finding.update(opportunityEvidence=[evidence(1)], responseEvidence=[evidence(1)])
    invalid["competencyAssessments"][0]["findings"] = [finding]
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["assessmentStatus"] == "observed"
    assert "same turn as both opportunity and response" in create.call_args.kwargs["messages"][-1]["content"]


@pytest.mark.asyncio
@pytest.mark.parametrize("omission", [False, True])
async def test_critical_errors_reference_declared_rule_and_learner_evidence(
    evaluator, request_data, valid_output, omission
):
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    if omission:
        request_data.turns = [
            {"sequence": 7, "speaker": "assistant", "text": "Please verify my budget."},
            {"sequence": 9, "speaker": "user", "text": "Let's move on."},
        ]
        finding = missed_finding()
    del finding["behaviorId"]
    finding.update(kind="critical_error", criticalErrorId="false_budget")
    valid_output["competencyAssessments"][0]["findings"] = [finding]
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    accepted = result["competencyAssessments"][0]["findings"][0]
    assert accepted["criticalErrorId"] == "false_budget"
    assert "behaviorId" not in accepted
    assert accepted["opportunityTurnNumbers"] == ([7] if omission else [])
    assert accepted["responseTurnNumbers"] == ([9] if omission else [])
    assert [item["turnNumber"] for item in accepted["evidence"]] == ([7, 9] if omission else [1])


@pytest.mark.asyncio
async def test_repeated_behavior_findings_are_retained_without_numeric_scoring(evaluator, request_data, valid_output):
    repeated = copy.deepcopy(valid_output["competencyAssessments"][0]["findings"][0])
    repeated["id"] = "asked_budget_again"
    valid_output["competencyAssessments"][0]["findings"].append(repeated)
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert [item["behaviorId"] for item in result["competencyAssessments"][0]["findings"]] == [
        "ask_budget",
        "ask_budget",
    ]
    assert "score" not in result["competencyAssessments"][0]


@pytest.mark.asyncio
async def test_poor_attempt_is_observed_without_satisfying_behavior_anchor(evaluator, request_data, valid_output):
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    finding.update(kind="attempted", rationale="The learner tried discovery but did not meet the behavior anchor")
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assessment = result["competencyAssessments"][0]
    assert assessment["assessmentStatus"] == "observed"
    assert assessment["findings"][0]["kind"] == "attempted"
    assert assessment["findings"][0]["behaviorId"] == "ask_budget"
    assert "score" not in assessment


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["  What is your budget?  ", "bảy phẩy một phần trăm.", "  ba\u0309y phẩy một…\n", ""])
async def test_quotes_are_resolved_from_transcript_without_model_copying(evaluator, request_data, valid_output, text):
    request_data.turns[0].update(sequence=11, text=text)
    valid_output["competencyAssessments"][0]["findings"][0]["behaviorEvidence"][0]["turnNumber"] = 11
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["findings"][0]["evidence"][0].get("quote") == (text or None)
    assert evaluator._client.chat.completions.create.await_count == 1
    assert "quote" not in valid_output["competencyAssessments"][0]["findings"][0]["behaviorEvidence"][0]


@pytest.mark.parametrize("scope", ["finding", "objective", "objection"])
@pytest.mark.parametrize("mismatch", ["normalized_number", "different_turn"])
def test_wire_quote_validation_still_rejects_mismatches(request_data, valid_output, scope, mismatch):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "Lãi suất cao quá."},
        {"sequence": 11, "speaker": "user", "text": "bảy phẩy một phần trăm."},
    ]
    valid_output["competencyAssessments"][0]["findings"][0]["behaviorEvidence"] = [evidence(11)]
    valid_output.update(objectiveOutcome="achieved", objectiveEvidence=[evidence(11)])
    valid_output["objectionOutcomes"][0].update(status="handled", evidence=[evidence(7), evidence(11)])
    generated = GeneratedEvaluationOutput.model_validate(valid_output)
    output = generated.to_evaluation_output(request_data)
    item = {
        "finding": output.competencyAssessments[0].findings[0].evidence[0],
        "objective": output.objectiveEvidence[0],
        "objection": output.objectionOutcomes[0].evidence[1],
    }[scope]
    assert item.quote == "bảy phẩy một phần trăm."
    if mismatch == "normalized_number":
        item.quote = "7,1%."
    else:
        item.turnNumber = 7
    with pytest.raises(ValueError, match="Evidence quote must match the transcript at turnNumber exactly"):
        output.validate_references(request_data)


@pytest.mark.asyncio
async def test_typed_collections_normalize_text_without_changing_wire_evidence(evaluator, request_data, valid_output):
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    finding["rationale"] = "  The learner asked about budget  "
    finding["behaviorEvidence"][0]["observation"] = "  Exact behavior observation  "
    finding["contextEvidence"] = [evidence(1)]
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    accepted = result["competencyAssessments"][0]["findings"][0]
    assert accepted["rationale"] == "The learner asked about budget"
    assert accepted["evidence"] == [
        {"turnNumber": 1, "quote": "What is your budget?", "observation": "Exact behavior observation"},
        evidence(1, "What is your budget?"),
    ]
    assert accepted["opportunityTurnNumbers"] == accepted["responseTurnNumbers"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["demonstrated", "attempted"])
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("behaviorId", None),
        ("behaviorId", "unknown"),
        ("criticalErrorId", "false_budget"),
        ("kind", "unknown"),
        ("id", " "),
        ("id", "Invalid-id"),
        ("behaviorId", "invalid-id"),
        ("rationale", " "),
        ("behaviorEvidence", []),
        ("behaviorEvidence", None),
        ("opportunityEvidence", [evidence(1)]),
        ("responseEvidence", [evidence(1)]),
        ("evidence", [evidence(1)]),
        ("contextEvidence", None),
    ],
)
async def test_invalid_finding_shape_or_rule_is_regenerated(evaluator, request_data, valid_output, field, value, kind):
    valid_output["competencyAssessments"][0]["findings"][0]["kind"] = kind
    invalid = copy.deepcopy(valid_output)
    invalid["competencyAssessments"][0]["findings"][0][field] = value
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["findings"][0]["behaviorId"] == "ask_budget"
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "duplicate_finding",
        "duplicate_code",
        "unknown_code",
        "missing_code",
        "unknown_insight",
        "missing_insight",
        "missing_objection",
        "unknown_objection",
        "duplicate_objection",
    ],
)
async def test_finding_ids_and_exact_practice_keys_are_validated(evaluator, request_data, valid_output, case):
    invalid = copy.deepcopy(valid_output)
    assessment = invalid["competencyAssessments"][0]
    if case == "duplicate_finding":
        assessment["findings"] *= 2
    elif case == "duplicate_code":
        invalid["competencyAssessments"] *= 2
    elif case == "unknown_code":
        assessment["competencyCode"] = "unknown"
    elif case == "missing_code":
        invalid["competencyAssessments"] = []
    elif case == "unknown_insight":
        invalid["insightDiscovery"] = {"unknown": False}
    elif case == "missing_insight":
        invalid["insightDiscovery"] = {}
    elif case == "missing_objection":
        invalid["objectionOutcomes"] = []
    elif case == "unknown_objection":
        invalid["objectionOutcomes"][0]["key"] = "unknown"
    else:
        invalid["objectionOutcomes"] *= 2
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    assert create.await_count == 2
    if case == "missing_objection":
        assert "missing=['price']" in create.call_args.kwargs["messages"][-1]["content"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("summary", "Model narrative"),
        ("strengths", ["Claim"]),
        ("improvements", ["Claim"]),
        ("keyCoachingPoint", "Claim"),
        ("objectiveFeedback", "Claim"),
        ("recommendation", {"reason": "Claim"}),
        ("competencyScores", [{"score": 70}]),
    ],
)
async def test_legacy_model_narrative_and_scores_are_rejected(evaluator, request_data, valid_output, field, value):
    invalid = copy.deepcopy(valid_output)
    invalid[field] = value
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("score", 70),
        ("feedback", "Model narrative"),
        ("evidence", []),
        ("reached", True),
        ("assessmentStatus", "observed"),
        ("assessmentStatus", "opportunity_missed"),
        ("assessmentStatus", "not_assessed"),
    ],
)
async def test_legacy_competency_fields_are_rejected(evaluator, request_data, valid_output, field, value):
    invalid = copy.deepcopy(valid_output)
    invalid["competencyAssessments"][0][field] = value
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["opportunityTurnNumbers", "responseTurnNumbers"])
@pytest.mark.parametrize("value", [[], [1]])
async def test_legacy_model_reference_arrays_are_rejected(evaluator, request_data, valid_output, field, value):
    invalid = copy.deepcopy(valid_output)
    invalid["competencyAssessments"][0]["findings"][0][field] = value
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("collection", ["behaviorEvidence", "contextEvidence"])
async def test_performed_finding_requires_explicit_collections(evaluator, request_data, valid_output, collection):
    invalid = copy.deepcopy(valid_output)
    del invalid["competencyAssessments"][0]["findings"][0][collection]
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["findings"][0]["evidence"] == [evidence(1, "What is your budget?")]
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_missed_and_critical_findings_can_coexist(evaluator, request_data, valid_output):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Your budget must be a million."},
    ]
    critical = {
        "id": "invented_budget",
        "kind": "critical_error",
        "criticalErrorId": "false_budget",
        "rationale": "The learner invented a budget",
        "behaviorEvidence": [evidence(9)],
        "contextEvidence": [],
    }
    valid_output["competencyAssessments"][0]["findings"] = [missed_finding(), critical]
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["assessmentStatus"] == "observed"
    assert len(result["competencyAssessments"][0]["findings"]) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["demonstrated", "attempted"])
async def test_performed_behavior_with_missed_opportunity_is_observed(evaluator, request_data, valid_output, kind):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Let's discuss the budget."},
    ]
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    finding.update(kind=kind, behaviorEvidence=[evidence(9)])
    valid_output["competencyAssessments"][0]["findings"] = [missed_finding(), finding]
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["assessmentStatus"] == "observed"
    assert [item["kind"] for item in result["competencyAssessments"][0]["findings"]] == ["opportunity_missed", kind]
    assert evaluator._client.chat.completions.create.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("turnNumber", None),
        ("turnNumber", 0),
        ("turnNumber", True),
        ("turnNumber", 1.0),
        ("turnNumber", 99),
        ("quote", "Invented quote"),
        ("quote", ""),
        ("observation", " "),
        ("role", "behavior"),
        ("role", "context"),
        ("role", "unknown"),
        ("role", None),
    ],
)
async def test_evidence_must_be_anchored_exact_and_nonempty(evaluator, request_data, valid_output, field, value):
    invalid = copy.deepcopy(valid_output)
    invalid["competencyAssessments"][0]["findings"][0]["behaviorEvidence"][0][field] = value
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["demonstrated", "attempted", "critical_error"])
async def test_behavioral_actions_cannot_rely_on_buyer_only_evidence(evaluator, request_data, valid_output, kind):
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    finding["kind"] = kind
    if kind == "critical_error":
        del finding["behaviorId"]
        finding["criticalErrorId"] = "false_budget"
    request_data.turns[0]["speaker"] = "assistant"
    request_data.turns.append({"sequence": 3, "speaker": "user", "text": "Hello."})
    finding["contextEvidence"].append(evidence(3))
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_critical_commission_requires_behavior_evidence_not_learner_context(
    evaluator, request_data, valid_output
):
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    del finding["behaviorId"]
    finding.update(kind="critical_error", criticalErrorId="false_budget")
    finding["contextEvidence"] = finding["behaviorEvidence"]
    finding["behaviorEvidence"] = []
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "missing_response_collection",
        "missing_opportunity_collection",
        "invented_response",
        "invented_opportunity",
        "buyer_response",
        "earlier_response",
        "same_turn_response",
        "mixed_early_response",
        "empty_opportunity_evidence",
        "empty_response_evidence",
        "critical_partial_collections",
    ],
)
async def test_omissions_require_grounded_opportunity_and_later_learner_response(
    evaluator, request_data, valid_output, case
):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Let's schedule a visit."},
    ]
    finding = missed_finding()
    assessment = valid_output["competencyAssessments"][0]
    assessment["findings"] = [finding]
    if case == "missing_response_collection":
        del finding["responseEvidence"]
    elif case == "missing_opportunity_collection":
        del finding["opportunityEvidence"]
    elif case == "invented_response":
        finding["responseEvidence"][0]["turnNumber"] = 99
    elif case == "invented_opportunity":
        finding["opportunityEvidence"][0]["turnNumber"] = 99
    elif case == "buyer_response":
        request_data.turns[1]["speaker"] = "assistant"
    elif case == "mixed_early_response":
        request_data.turns.insert(0, {"sequence": 5, "speaker": "user", "text": "Hello."})
        finding["responseEvidence"].append(evidence(5))
    elif case == "earlier_response":
        request_data.turns[1]["sequence"] = 5
        finding["responseEvidence"][0]["turnNumber"] = 5
    elif case == "same_turn_response":
        finding["opportunityEvidence"][0]["turnNumber"] = 9
    elif case == "empty_opportunity_evidence":
        finding["opportunityEvidence"] = []
    elif case == "empty_response_evidence":
        finding["responseEvidence"] = []
    else:
        del finding["behaviorId"]
        finding.update(
            kind="critical_error", criticalErrorId="false_budget", responseEvidence=[], contextEvidence=[evidence(9)]
        )
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["demonstrated", "attempted", "critical_error"])
async def test_rule_ids_must_belong_to_assessed_competency(evaluator, request_data, valid_output, kind):
    other = copy.deepcopy(request_data.competencies[0])
    other["code"] = "other"
    other["rubric"]["behaviors"][0]["id"] = "other_behavior"
    other["rubric"]["levels"][1]["requiredBehaviorIds"] = ["other_behavior"]
    other["rubric"]["criticalErrors"][0]["id"] = "other_error"
    request_data.competencies.append(other)
    valid_output["competencyAssessments"].append({"competencyCode": "other", "findings": []})
    finding = valid_output["competencyAssessments"][0]["findings"][0]
    finding["kind"] = kind
    if kind == "critical_error":
        del finding["behaviorId"]
        finding["criticalErrorId"] = "other_error"
    else:
        finding["behaviorId"] = "other_behavior"
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["achieved", "partially_achieved", "not_achieved"])
async def test_objective_outcomes_preserve_anchored_evidence(evaluator, request_data, valid_output, outcome):
    valid_output.update(objectiveOutcome=outcome, objectiveEvidence=[evidence(1)])
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["objectiveOutcome"] == outcome
    assert result["objectiveEvidence"] == [evidence(1, "What is your budget?")]


@pytest.mark.asyncio
async def test_custom_finding_rule_reaches_retry_without_rejected_text(evaluator, request_data, valid_output, caplog):
    invalid = copy.deepcopy(valid_output)
    finding = invalid["competencyAssessments"][0]["findings"][0]
    finding["behaviorEvidence"][0]["turnNumber"] = 7
    request_data.turns.append({"sequence": 7, "speaker": "assistant", "text": "private buyer text marker"})
    finding["rationale"] = "private generated rationale marker"
    finding["behaviorEvidence"][0]["observation"] = "private observation marker"
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["assessmentStatus"] == "observed"
    feedback = create.call_args.kwargs["messages"][-1]["content"]
    assert "competencyAssessments.0.findings.0" in feedback
    assert "learner" in feedback.lower()
    assert "private generated rationale marker" not in feedback
    assert "private observation marker" not in feedback
    assert "private generated rationale marker" not in caplog.text
    assert "private observation marker" not in caplog.text
    assert "private buyer text marker" not in feedback
    assert "private buyer text marker" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "null_with_evidence",
        "outcome_without_evidence",
        "invented_turn",
        "invented_quote",
        "achieved_buyer_only",
        "partial_buyer_only",
    ],
)
async def test_objective_evidence_contract_is_enforced(evaluator, request_data, valid_output, case):
    valid_output.update(objectiveOutcome="achieved", objectiveEvidence=[evidence(1)])
    if case == "null_with_evidence":
        valid_output["objectiveOutcome"] = None
    elif case == "outcome_without_evidence":
        valid_output["objectiveEvidence"] = []
    elif case == "invented_turn":
        valid_output["objectiveEvidence"] = [evidence(99)]
    elif case == "invented_quote":
        valid_output["objectiveEvidence"] = [evidence(1, "Invented")]
    else:
        valid_output["competencyAssessments"][0]["findings"] = []
        request_data.turns[0]["speaker"] = "assistant"
        if case == "partial_buyer_only":
            valid_output["objectiveOutcome"] = "partially_achieved"
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)


@pytest.mark.asyncio
@pytest.mark.parametrize("handling", ["handled", "partially_handled", "not_handled"])
async def test_objections_require_buyer_and_subsequent_handling_evidence(
    evaluator, request_data, valid_output, handling
):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "The price is too high."},
        {"sequence": 9, "speaker": "user", "text": "What is your budget?"},
    ]
    valid_output["competencyAssessments"][0]["findings"][0]["behaviorEvidence"][0]["turnNumber"] = 9
    valid_output["objectionOutcomes"][0].update(status=handling, evidence=[evidence(7), evidence(9)])
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["objectionOutcomes"][0]["raised"] is True
    assert result["objectionOutcomes"][0]["handling"] == handling
    assert result["objectionOutcomes"][0]["evidence"] == [
        evidence(7, "The price is too high."),
        evidence(9, "What is your budget?"),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "legacy_raised",
        "legacy_handling",
        "unraised_evidence",
        "null_status",
        "missing_status",
        "unknown_status",
        "raised_no_evidence",
        "raised_learner_only",
        "handled_buyer_only",
        "partial_buyer_only",
        "handled_earlier_learner",
        "invented_turn",
        "invented_quote",
    ],
)
async def test_invalid_objection_evidence_is_rejected(evaluator, request_data, valid_output, case):
    request_data.turns.append({"sequence": 7, "speaker": "assistant", "text": "The price is too high."})
    # A later learner turn exists, so missing handling evidence is repairable, not a terminal objection.
    request_data.turns.append({"sequence": 9, "speaker": "user", "text": "Let me explain the payment plan."})
    outcome = valid_output["objectionOutcomes"][0]
    outcome.update(status="handled", evidence=[evidence(7), evidence(1)])
    if case == "legacy_raised":
        outcome.update(status="not_raised", raised=True, evidence=[])
    elif case == "legacy_handling":
        outcome.update(status="not_raised", handling="handled", evidence=[])
    elif case == "unraised_evidence":
        outcome["status"] = "not_raised"
    elif case == "null_status":
        outcome["status"] = None
    elif case == "missing_status":
        del outcome["status"]
    elif case == "unknown_status":
        outcome["status"] = "unknown"
    elif case == "raised_no_evidence":
        outcome.update(status="not_handled", evidence=[])
    elif case == "raised_learner_only":
        outcome.update(status="not_handled", evidence=[evidence(1)])
    elif case in {"handled_buyer_only", "partial_buyer_only"}:
        outcome.update(
            status="handled" if case == "handled_buyer_only" else "partially_handled", evidence=[evidence(7)]
        )
    elif case == "invented_turn":
        outcome["evidence"] = [evidence(99)]
    elif case == "invented_quote":
        outcome["evidence"] = [evidence(7, "Invented")]
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)


@pytest.mark.asyncio
@pytest.mark.parametrize("handling", ["handled", "partially_handled"])
async def test_objection_ending_the_call_is_not_handled_without_regenerating(
    evaluator, request_data, valid_output, handling
):
    request_data.turns.append({"sequence": 7, "speaker": "assistant", "text": "The price is too high."})
    valid_output["objectionOutcomes"][0].update(status=handling, evidence=[evidence(1), evidence(7)])
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["objectionOutcomes"][0]["raised"] is True
    assert result["objectionOutcomes"][0]["handling"] == "not_handled"
    assert create.await_count == 1


@pytest.mark.asyncio
async def test_unanswered_handled_objection_gets_actionable_retry_feedback(evaluator, request_data, valid_output):
    request_data.turns += [
        {"sequence": 7, "speaker": "assistant", "text": "The price is too high."},
        {"sequence": 9, "speaker": "user", "text": "Let me explain the payment plan."},
    ]
    invalid = copy.deepcopy(valid_output)
    invalid["objectionOutcomes"][0].update(status="handled", evidence=[evidence(7)])
    valid_output["objectionOutcomes"][0].update(status="handled", evidence=[evidence(7), evidence(9)])
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["objectionOutcomes"][0]["handling"] == "handled"
    feedback = create.call_args.kwargs["messages"][-1]["content"]
    assert "objectionOutcomes.0 (price)" in feedback
    assert "buyer evidence sequences=[7], later learner sequences=[9]" in feedback
    assert "not_handled" in feedback


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["demonstrated", "critical_error"])
async def test_unknown_rule_id_gets_actionable_retry_feedback(evaluator, request_data, valid_output, kind):
    invalid = copy.deepcopy(valid_output)
    finding = invalid["competencyAssessments"][0]["findings"][0]
    if kind == "critical_error":
        del finding["behaviorId"]
        finding.update(kind="critical_error", criticalErrorId="met")
    else:
        finding["behaviorId"] = "met"
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    feedback = create.call_args.kwargs["messages"][-1]["content"]
    assert "competencyAssessments.0.findings.0" in feedback
    if kind == "critical_error":
        assert "valid criticalErrorIds for discovery: ['false_budget']" in feedback
    else:
        assert "valid behaviorIds for discovery: ['ask_budget']" in feedback
    # The rejected id is model output and stays out of the diagnostics.
    assert "'met'" not in feedback


def test_schema_scopes_rule_ids_to_each_competency(request_data):
    other = copy.deepcopy(request_data.competencies[0])
    other["code"] = "other"
    other["rubric"]["behaviors"] = [{"id": "other_behavior", "description": "Do the other thing"}]
    other["rubric"]["criticalErrors"] = []
    request_data.competencies.append(other)
    request_data.turns.append({"sequence": 3, "speaker": "assistant", "text": "Why?"})
    request_data.turns.append({"sequence": 5, "speaker": "user", "text": "Because."})
    schema = GeneratedEvaluationOutput.request_json_schema(request_data)
    definitions = schema["$defs"]
    assert schema["properties"]["competencyAssessments"]["items"] == {
        "anyOf": [
            {"$ref": "#/$defs/GeneratedCompetencyAssessment_0"},
            {"$ref": "#/$defs/GeneratedCompetencyAssessment_1"},
        ]
    }
    for index, code, behaviors, critical_errors in [
        (0, "discovery", ["ask_budget"], ["false_budget"]),
        (1, "other", ["other_behavior"], None),
    ]:
        assessment = definitions[f"GeneratedCompetencyAssessment_{index}"]["properties"]
        assert assessment["competencyCode"]["enum"] == [code]
        refs = {ref["$ref"].rsplit("/", 1)[-1] for ref in assessment["findings"]["items"]["anyOf"]}
        expected = {f"GeneratedPerformedFinding_{index}", f"GeneratedMissedFinding_{index}"}
        if critical_errors:
            expected |= {f"GeneratedCriticalCommission_{index}", f"GeneratedCriticalOmission_{index}"}
        assert refs == expected
        for name in refs:
            fields = definitions[name]["properties"]
            rule_field = "criticalErrorId" if "criticalErrorId" in fields else "behaviorId"
            assert fields[rule_field]["enum"] == (critical_errors if rule_field == "criticalErrorId" else behaviors)


def test_schema_keeps_empty_findings_valid_when_competency_has_no_usable_rules(request_data):
    request_data.competencies[0]["rubric"]["criticalErrors"] = []
    request_data.turns = [{"sequence": 1, "speaker": "assistant", "text": "Hello?"}]
    schema = GeneratedEvaluationOutput.request_json_schema(request_data)
    findings = schema["$defs"]["GeneratedCompetencyAssessment_0"]["properties"]["findings"]
    assert findings["maxItems"] == 0
    for ref in findings["items"]["anyOf"]:
        assert ref["$ref"].rsplit("/", 1)[-1] in schema["$defs"]


@pytest.mark.asyncio
async def test_evidence_uses_event_sequences_with_gaps(evaluator, request_data, valid_output):
    request_data.turns[0]["sequence"] = 9
    valid_output["competencyAssessments"][0]["findings"][0]["behaviorEvidence"][0]["turnNumber"] = 9
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"][0]["findings"][0]["evidence"][0]["turnNumber"] == 9


@pytest.mark.asyncio
async def test_bad_evidence_sequence_gets_actionable_retry_feedback(evaluator, request_data, valid_output):
    request_data.turns[0]["sequence"] = 9
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    with pytest.raises(EvaluationError) as caught:
        await evaluator.generate_practice(request_data)
    assert caught.value.code == "evaluation_invalid_output"
    assert "valid sequences: [9]" in caught.value.reason
    assert "valid sequences: [9]" in create.call_args.kwargs["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_empty_practice_key_collections_allow_empty_assessments(evaluator, request_data, valid_output):
    request_data.competencies = []
    request_data.agentConfig = {"hiddenInsights": [], "objections": []}
    valid_output.update(competencyAssessments=[], objectionOutcomes=[], insightDiscovery={})
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["competencyAssessments"] == result["objectionOutcomes"] == result["missedInsightKeys"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("decisions", [(False, False, False), (True, False, True), (True, True, True)])
async def test_insight_decisions_require_every_key_and_derive_wire_arrays(
    evaluator, request_data, valid_output, decisions
):
    keys = ["lease_ends", "monthly_payment_limit", "wife_decides_location"]
    request_data.agentConfig["hiddenInsights"] = [{"key": key} for key in keys]
    # Model property ordering must not affect the stable practice order on the wire.
    valid_output["insightDiscovery"] = dict(reversed(list(zip(keys, decisions, strict=True))))
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    result = await evaluator.generate_practice(request_data)
    assert result["discoveredInsightKeys"] == [
        key for key, discovered in zip(keys, decisions, strict=True) if discovered
    ]
    assert result["missedInsightKeys"] == [
        key for key, discovered in zip(keys, decisions, strict=True) if not discovered
    ]
    assert "insightDiscovery" not in result
    assert create.await_count == 1
    schema = create.call_args.kwargs["response_format"]["json_schema"]["schema"]
    insights = schema["properties"]["insightDiscovery"]
    assert insights == {
        "type": "object",
        "properties": dict.fromkeys(keys, {"type": "boolean"}),
        "required": keys,
        "additionalProperties": False,
    }
    assert not {"discoveredInsightKeys", "missedInsightKeys"} & schema["properties"].keys()


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", [None, "false", "true", 0, 1, [], {}])
async def test_insight_decisions_are_explicit_booleans(evaluator, request_data, valid_output, decision):
    invalid = copy.deepcopy(valid_output)
    invalid["insightDiscovery"]["budget"] = decision
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(json.dumps(invalid)), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["missedInsightKeys"] == ["budget"]
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_missing_insight_decision_is_repaired_not_silently_marked_missed(evaluator, request_data, valid_output):
    request_data.agentConfig["hiddenInsights"].append({"key": "lease_ends"})
    invalid = copy.deepcopy(valid_output)
    valid_output["insightDiscovery"]["lease_ends"] = True
    create = evaluator._client.chat.completions.create
    rejected = json.dumps(invalid)
    create.side_effect = [completion(rejected), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["discoveredInsightKeys"] == ["lease_ends"]
    assert result["missedInsightKeys"] == ["budget"]
    first, second = create.call_args_list
    assert len(first.kwargs["messages"]) == 1
    retry_messages = second.kwargs["messages"]
    assert [message["role"] for message in retry_messages] == ["user", "assistant", "user"]
    assert retry_messages[-2]["content"] == rejected
    assert "missing=['lease_ends']" in retry_messages[-1]["content"]


@pytest.mark.asyncio
async def test_duplicate_json_insight_decisions_are_rejected(evaluator, request_data, valid_output):
    invalid = json.dumps(valid_output).replace('"budget": false', '"budget": true, "budget": false')
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion(invalid), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["missedInsightKeys"] == ["budget"]
    assert create.await_count == 2
    assert "duplicate object keys" in create.call_args.kwargs["messages"][-1]["content"]


def test_objection_generation_schema_requires_one_status_with_matching_evidence(request_data):
    request_data.turns.append({"sequence": 7, "speaker": "assistant", "text": "The price is too high."})
    schema = GeneratedEvaluationOutput.request_json_schema(request_data)
    items = schema["properties"]["objectionOutcomes"]["items"]["anyOf"]
    assert len(items) == 2
    for item in items:
        branch = schema["$defs"][item["$ref"].rsplit("/", 1)[-1]]
        assert set(branch["properties"]) == set(branch["required"]) == {"key", "status", "evidence"}
        assert branch["additionalProperties"] is False
        status = branch["properties"]["status"]
        if status.get("const") == "not_raised":
            assert branch["properties"]["evidence"]["maxItems"] == 0
        else:
            assert status["enum"] == ["handled", "partially_handled", "not_handled"]
            assert status["type"] == "string"
            assert branch["properties"]["evidence"]["minItems"] == 1


@pytest.mark.parametrize("turns", [[], [{"sequence": 1, "speaker": "user", "text": "Hello?"}]])
def test_objection_schema_without_buyer_turns_only_allows_not_raised(request_data, turns):
    request_data.turns = turns
    schema = GeneratedEvaluationOutput.request_json_schema(request_data)
    ref = schema["properties"]["objectionOutcomes"]["items"]["$ref"]
    branch = schema["$defs"][ref.rsplit("/", 1)[-1]]
    assert branch["properties"]["status"]["const"] == "not_raised"
    assert branch["properties"]["evidence"]["maxItems"] == 0


@pytest.mark.parametrize("case", ["raised_without_handling", "unraised_with_handling", "unraised_with_evidence"])
def test_wire_contract_still_rejects_inconsistent_objections(request_data, valid_output, case):
    output = GeneratedEvaluationOutput.model_validate(valid_output).to_evaluation_output(request_data).model_dump()
    outcome = output["objectionOutcomes"][0]
    if case == "raised_without_handling":
        outcome["raised"] = True
    elif case == "unraised_with_handling":
        outcome["handling"] = "handled"
    else:
        outcome["evidence"] = [evidence(1, "What is your budget?")]
    with pytest.raises(ValidationError):
        EvaluationOutput.model_validate(output)


@pytest.mark.asyncio
async def test_invalid_json_is_regenerated_once(evaluator, request_data, valid_output):
    create = evaluator._client.chat.completions.create
    create.side_effect = [completion('{"discoveredInsightKeys":'), completion(json.dumps(valid_output))]
    result = await evaluator.generate_practice(request_data)
    assert result["missedInsightKeys"] == ["budget"]
    assert create.await_count == 2
    assert "Invalid JSON" in create.call_args.kwargs["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_truncation_retries_with_larger_output_budget(evaluator, request_data, valid_output):
    create = evaluator._client.chat.completions.create
    create.side_effect = [
        completion(json.dumps(valid_output), finish_reason="length"),
        completion(json.dumps(valid_output)),
    ]
    await evaluator.generate_practice(request_data)
    first, second = create.call_args_list
    assert second.kwargs["max_tokens"] == first.kwargs["max_tokens"] * 2


@pytest.mark.asyncio
async def test_retry_exhaustion_returns_controlled_error_without_logging_content(evaluator, request_data, caplog):
    create = evaluator._client.chat.completions.create
    create.return_value = completion("private transcript marker is not JSON")
    with pytest.raises(EvaluationError, match="evaluation_invalid_output"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 2
    assert "private transcript marker" not in caplog.text
    assert "evaluation-response" in caplog.text
    assert "finish_reason=stop" in caplog.text


def provider_error(status):
    return APIStatusError(
        "Provider error",
        response=httpx.Response(status, request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")),
        body=None,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        provider_error(408),
        provider_error(409),
        provider_error(429),
        provider_error(503),
        APIConnectionError(request=httpx.Request("POST", "https://example.com")),
    ],
)
async def test_temporary_provider_failure_retries_once(evaluator, request_data, valid_output, error):
    create = evaluator._client.chat.completions.create
    create.side_effect = [error, completion(json.dumps(valid_output))]
    await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_attempt_timing_is_logged_for_failures_and_responses(evaluator, request_data, valid_output, caplog):
    caplog.set_level("INFO", logger=evaluation.logger.name)
    create = evaluator._client.chat.completions.create
    timeout = APIConnectionError(request=httpx.Request("POST", "https://example.com"))
    create.side_effect = [timeout, completion(json.dumps(valid_output), usage=TOKENS)]
    await evaluator.generate_practice(request_data)
    failed, responded, completed = (
        record.getMessage()
        for record in caplog.records
        if record.getMessage().startswith(
            ("Evaluation attempt failed", "Evaluation attempt response", "Evaluation completed")
        )
    )
    assert "attempt=1 seconds=" in failed
    assert "attempt=2 seconds=" in responded
    assert "finish_reason=stop output_tokens=500" in responded
    assert completed.startswith("Evaluation completed model=evaluation-model seconds=")


@pytest.mark.asyncio
async def test_temporary_provider_failure_stops_after_second_attempt(evaluator, request_data):
    create = evaluator._client.chat.completions.create
    create.side_effect = provider_error(503)
    with pytest.raises(EvaluationError, match="evaluation_provider_unavailable"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 401, 403])
async def test_configuration_and_authentication_failures_do_not_retry(evaluator, request_data, status):
    create = evaluator._client.chat.completions.create
    create.side_effect = provider_error(status)
    with pytest.raises(EvaluationError, match="evaluation_provider_rejected"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("filtered", [False, True])
async def test_refusal_does_not_retry(evaluator, request_data, filtered):
    create = evaluator._client.chat.completions.create
    create.return_value = completion(
        None, finish_reason="content_filter" if filtered else "stop", refusal=None if filtered else "Cannot evaluate"
    )
    with pytest.raises(EvaluationError, match="evaluation_refused"):
        await evaluator.generate_practice(request_data)
    assert create.await_count == 1


@pytest.mark.asyncio
async def test_whole_operation_has_a_deadline(evaluator, request_data, monkeypatch):
    monkeypatch.setattr(evaluation, "EVALUATION_TIMEOUT_SECONDS", 0.01)

    async def stalled_response(**kwargs):
        await asyncio.sleep(10)

    evaluator._client.chat.completions.create.side_effect = stalled_response
    with pytest.raises(EvaluationError, match="evaluation_timeout"):
        await evaluator.generate_practice(request_data)


@pytest.mark.asyncio
async def test_api_returns_502_after_invalid_output_and_still_requires_auth(evaluator, request_data):
    evaluator._client.chat.completions.create.return_value = completion("invalid JSON")
    current = SimpleNamespace(
        settings=SimpleNamespace(voice_control_api_key=SecretStr("control-key")), evaluator=evaluator
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        unauthorized = await client.post("/internal/evaluations", json=request_data.model_dump())
        assert unauthorized.status_code == 401
        assert evaluator._client.chat.completions.create.await_count == 0
        response = await client.post(
            "/internal/evaluations", json=request_data.model_dump(), headers={"authorization": "Bearer control-key"}
        )
    assert response.status_code == 502
    assert response.json() == {
        "detail": {"code": "evaluation_invalid_output", "reason": "Invalid JSON: Expecting value at line 1, column 1"}
    }
    assert evaluator._client.chat.completions.create.await_count == 2


@pytest.mark.asyncio
async def test_api_returns_validated_findings(evaluator, request_data, valid_output):
    evaluator._client.chat.completions.create.return_value = completion(json.dumps(valid_output))
    current = SimpleNamespace(
        settings=SimpleNamespace(voice_control_api_key=SecretStr("control-key")), evaluator=evaluator
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        result = await client.post(
            "/internal/evaluations", json=request_data.model_dump(), headers={"authorization": "Bearer control-key"}
        )
    assert result.status_code == 200
    findings = result.json()
    assert set(findings) == {
        "discoveredInsightKeys",
        "missedInsightKeys",
        "objectiveEvidence",
        "objectionOutcomes",
        "competencyAssessments",
    }
    assert findings["missedInsightKeys"] == ["budget"]
    assert findings["competencyAssessments"][0]["findings"][0]["evidence"] == [evidence(1, "What is your budget?")]
    assert findings["competencyAssessments"][0]["findings"][0]["opportunityTurnNumbers"] == []
    assert findings["competencyAssessments"][0]["findings"][0]["responseTurnNumbers"] == []
    assert (
        not {"behaviorEvidence", "opportunityEvidence", "responseEvidence", "contextEvidence"}
        & findings["competencyAssessments"][0]["findings"][0].keys()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("last_status", ["opportunity_missed", "not_assessed"])
async def test_api_derives_fifth_competency_status_without_regenerating(
    evaluator, request_data, valid_output, last_status
):
    request_data.turns = [
        {"sequence": 7, "speaker": "assistant", "text": "What about my budget?"},
        {"sequence": 9, "speaker": "user", "text": "Let's discuss the property."},
    ]
    valid_output["competencyAssessments"][0]["findings"][0]["behaviorEvidence"] = [evidence(9)]
    for index in range(1, 5):
        competency = copy.deepcopy(request_data.competencies[0])
        competency["code"] = f"competency_{index}"
        request_data.competencies.append(competency)
        assessment = copy.deepcopy(valid_output["competencyAssessments"][0])
        assessment["competencyCode"] = competency["code"]
        valid_output["competencyAssessments"].append(assessment)
    valid_output["competencyAssessments"][4]["findings"] = (
        [missed_finding()] if last_status == "opportunity_missed" else []
    )
    create = evaluator._client.chat.completions.create
    create.return_value = completion(json.dumps(valid_output))
    current = SimpleNamespace(
        settings=SimpleNamespace(voice_control_api_key=SecretStr("control-key")), evaluator=evaluator
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/internal/evaluations", json=request_data.model_dump(), headers={"authorization": "Bearer control-key"}
        )
    assert response.status_code == 200
    assessments = response.json()["competencyAssessments"]
    assert [item["assessmentStatus"] for item in assessments] == ["observed"] * 4 + [last_status]
    assert [item["competencyCode"] for item in assessments] == [item["code"] for item in request_data.competencies]
    last_findings = assessments[4]["findings"]
    if last_status == "opportunity_missed":
        assert len(last_findings) == 1
        assert last_findings[0]["kind"] == "opportunity_missed"
        assert last_findings[0]["opportunityTurnNumbers"] == [7]
        assert last_findings[0]["responseTurnNumbers"] == [9]
        assert [item["turnNumber"] for item in last_findings[0]["evidence"]] == [7, 9]
    else:
        assert last_findings == []
    assert create.await_count == 1


TOKENS = {
    "prompt_tokens": 3000,
    "completion_tokens": 500,
    "total_tokens": 3500,
    "prompt_tokens_details": {"cached_tokens": 1000},
}


@pytest.mark.asyncio
async def test_api_reports_tokens_of_every_attempt_in_a_header(evaluator, request_data, valid_output):
    evaluator._client.chat.completions.create.side_effect = [
        completion("invalid JSON", usage=TOKENS),
        completion(json.dumps(valid_output), usage=TOKENS),
    ]
    current = SimpleNamespace(
        settings=SimpleNamespace(voice_control_api_key=SecretStr("control-key")), evaluator=evaluator
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/internal/evaluations", json=request_data.model_dump(), headers={"authorization": "Bearer control-key"}
        )
    assert response.status_code == 200
    assert "usage" not in response.json()
    assert json.loads(response.headers["x-service-usage"]) == [
        {
            "service": "llm",
            "provider": "openrouter",
            "model": "evaluation-model",
            "inputTokens": 6000,
            "cachedInputTokens": 2000,
            "outputTokens": 1000,
        }
    ]


@pytest.mark.asyncio
async def test_failed_evaluation_still_reports_its_tokens(evaluator, request_data):
    evaluator._client.chat.completions.create.return_value = completion("invalid JSON", usage=TOKENS)
    current = SimpleNamespace(
        settings=SimpleNamespace(voice_control_api_key=SecretStr("control-key")), evaluator=evaluator
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_runtime] = lambda: current
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/internal/evaluations", json=request_data.model_dump(), headers={"authorization": "Bearer control-key"}
        )
    assert response.status_code == 502
    assert json.loads(response.headers["x-service-usage"])[0]["inputTokens"] == 6000
