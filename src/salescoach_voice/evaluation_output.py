# ruff: noqa: N815
# Field names match the frontend evaluation wire contract.
from collections import Counter
from copy import deepcopy
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .models import EvaluationRequest


class EvaluationObject(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
TurnNumber = Annotated[int, Field(gt=0)]
RuleId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$")]
ExactQuote = Annotated[str, StringConstraints(min_length=1)]


class GeneratedEvaluationEvidence(EvaluationObject):
    turnNumber: TurnNumber
    observation: NonEmptyText


class EvaluationEvidence(GeneratedEvaluationEvidence):
    quote: ExactQuote | None


class ObjectionOutcome(EvaluationObject):
    key: str
    raised: bool
    handling: Literal["handled", "partially_handled", "not_handled"] | None
    evidence: list[EvaluationEvidence]

    @model_validator(mode="after")
    def validate_handling(self) -> Self:
        if self.raised:
            if self.handling is None:
                raise ValueError("Raised objections must include a handling outcome")
        elif self.handling is not None or self.evidence:
            raise ValueError("Unraised objections must use null handling and empty evidence")
        return self


class BehavioralFinding(EvaluationObject):
    id: RuleId
    kind: Literal["demonstrated", "attempted", "opportunity_missed", "critical_error"]
    behaviorId: RuleId | None
    criticalErrorId: RuleId | None
    rationale: NonEmptyText
    evidence: list[EvaluationEvidence] = Field(min_length=1)
    opportunityTurnNumbers: list[TurnNumber]
    responseTurnNumbers: list[TurnNumber]

    @model_validator(mode="after")
    def validate_finding_kind(self) -> Self:
        if len(set(self.opportunityTurnNumbers)) != len(self.opportunityTurnNumbers) or len(
            set(self.responseTurnNumbers)
        ) != len(self.responseTurnNumbers):
            raise ValueError("Opportunity and response reference arrays must not contain duplicates")
        if self.kind == "critical_error":
            if self.criticalErrorId is None or self.behaviorId is not None:
                raise ValueError("Critical errors must reference only a criticalErrorId")
            if bool(self.opportunityTurnNumbers) != bool(self.responseTurnNumbers):
                raise ValueError("Critical-error omissions require both opportunity and response references")
        else:
            if self.behaviorId is None or self.criticalErrorId is not None:
                raise ValueError("Behavior findings must reference only a behaviorId")
            if self.kind in {"demonstrated", "attempted"} and (self.opportunityTurnNumbers or self.responseTurnNumbers):
                raise ValueError(
                    "Demonstrated and attempted findings must use empty opportunity and response references"
                )
            if self.kind == "opportunity_missed" and not (self.opportunityTurnNumbers and self.responseTurnNumbers):
                raise ValueError("Missed opportunities require opportunity and learner response references")
        return self


class CompetencyAssessment(EvaluationObject):
    competencyCode: str
    assessmentStatus: Literal["observed", "opportunity_missed", "not_assessed"]
    findings: list[BehavioralFinding]

    @model_validator(mode="after")
    def validate_assessment_status(self) -> Self:
        findings = self.findings
        if len({item.id for item in findings}) != len(findings):
            raise ValueError("Finding ids must be unique within a competency")
        kinds = {item.kind for item in findings}
        if self.assessmentStatus == "not_assessed":
            if findings:
                raise ValueError("Not-assessed competencies must have no findings")
        elif self.assessmentStatus == "observed":
            if not kinds.intersection({"demonstrated", "attempted", "critical_error"}):
                raise ValueError("Observed competencies require a demonstrated, attempted or critical-error finding")
        elif "opportunity_missed" not in kinds or kinds.intersection({"demonstrated", "attempted"}):
            raise ValueError(
                "Opportunity-missed competencies require missed findings and no demonstrated or attempted findings"
            )
        return self


class EvaluationSummary(EvaluationObject):
    # Strict structured outputs require all properties; absent optional values
    # use null and are omitted on the wire.
    discoveredInsightKeys: list[str]
    missedInsightKeys: list[str]
    objectiveOutcome: Literal["achieved", "partially_achieved", "not_achieved"] | None
    objectiveEvidence: list[EvaluationEvidence]
    objectionOutcomes: list[ObjectionOutcome]

    @model_validator(mode="after")
    def validate_objective_evidence(self) -> Self:
        if self.objectiveOutcome is None:
            if self.objectiveEvidence:
                raise ValueError("An unassessed objective must have empty evidence")
        elif not self.objectiveEvidence:
            raise ValueError("Objective outcomes require anchored evidence")
        return self


class EvaluationOutput(EvaluationSummary):
    competencyAssessments: list[CompetencyAssessment]

    def validate_references(self, request: EvaluationRequest) -> None:
        competencies = {item["code"]: item for item in request.competencies}
        insight_keys = {item["key"] for item in request.agentConfig.get("hiddenInsights", [])}
        objection_keys = {item["key"] for item in request.agentConfig.get("objections", [])}
        self._require_exact_keys(
            [item.competencyCode for item in self.competencyAssessments], set(competencies), "competency codes"
        )
        self._require_exact_keys([item.key for item in self.objectionOutcomes], objection_keys, "objection keys")
        self._require_exact_keys(self.discoveredInsightKeys + self.missedInsightKeys, insight_keys, "insight keys")
        turns = {item["sequence"]: item for item in request.turns}
        evidence = [
            item
            for assessment in self.competencyAssessments
            for finding in assessment.findings
            for item in finding.evidence
        ]
        evidence.extend(self.objectiveEvidence)
        evidence.extend(item for outcome in self.objectionOutcomes for item in outcome.evidence)
        for item in evidence:
            self._require_turn(item.turnNumber, turns)
            if item.quote is not None and item.quote not in turns[item.turnNumber]["text"]:
                raise ValueError("Evidence quote must match the transcript at turnNumber exactly")
        for assessment_index, assessment in enumerate(self.competencyAssessments):
            rubric = competencies[assessment.competencyCode]["rubric"]
            behavior_ids = [item["id"] for item in rubric["behaviors"]]
            critical_error_ids = [item["id"] for item in rubric["criticalErrors"]]
            for finding_index, finding in enumerate(assessment.findings):
                # Name the location and the valid ids so the repair attempt can fix
                # the reference; never echo the rejected model-generated id.
                location = f"competencyAssessments.{assessment_index}.findings.{finding_index}"
                if finding.kind == "critical_error":
                    if finding.criticalErrorId not in critical_error_ids:
                        raise ValueError(
                            f"{location}: Critical-error finding must reference a supplied rubric criticalErrorId; "
                            f"valid criticalErrorIds for {assessment.competencyCode}: {critical_error_ids}. "
                            "Level ids and other competencies' rule ids are not rule ids; "
                            "remove the finding if none applies."
                        )
                elif finding.behaviorId not in behavior_ids:
                    raise ValueError(
                        f"{location}: Behavior finding must reference a supplied rubric behaviorId; "
                        f"valid behaviorIds for {assessment.competencyCode}: {behavior_ids}. "
                        "Level ids and other competencies' rule ids are not behaviorIds; "
                        "remove the finding if none applies."
                    )
                if finding.kind in {"demonstrated", "attempted", "critical_error"} and not any(
                    turns[item.turnNumber]["speaker"] == "user" for item in finding.evidence
                ):
                    raise ValueError("Demonstrated, attempted and critical-error findings require learner evidence")
                if finding.opportunityTurnNumbers:
                    self._validate_opportunity(finding, turns)
        if self.objectiveOutcome in {"achieved", "partially_achieved"} and not any(
            turns[item.turnNumber]["speaker"] == "user" for item in self.objectiveEvidence
        ):
            raise ValueError("Achieved or partially achieved objectives require learner evidence")
        for outcome_index, outcome in enumerate(self.objectionOutcomes):
            if not outcome.raised:
                continue
            location = f"objectionOutcomes.{outcome_index} ({outcome.key})"
            buyer_turns = sorted(
                item.turnNumber for item in outcome.evidence if turns[item.turnNumber]["speaker"] == "assistant"
            )
            if not buyer_turns:
                raise ValueError(f"{location}: Raised objections require buyer evidence")
            if outcome.handling in {"handled", "partially_handled"} and not any(
                turns[item.turnNumber]["speaker"] == "user" and item.turnNumber > buyer_turns[0]
                for item in outcome.evidence
            ):
                later_learner_turns = sorted(
                    number for number, turn in turns.items() if turn["speaker"] == "user" and number > buyer_turns[0]
                )
                raise ValueError(
                    f"{location}: Handled or partially handled objections require subsequent learner evidence; "
                    f"buyer evidence sequences={buyer_turns}, later learner sequences={later_learner_turns}. "
                    "Cite the later learner turn that responds to the objection, "
                    "or use status not_handled if none of them addresses it."
                )

    @classmethod
    def _validate_opportunity(cls, finding: BehavioralFinding, turns: dict[int, dict[str, Any]]) -> None:
        references = finding.opportunityTurnNumbers + finding.responseTurnNumbers
        for number in references:
            cls._require_turn(number, turns)
        evidence_turns = {item.turnNumber for item in finding.evidence}
        if not set(references).issubset(evidence_turns):
            raise ValueError("Finding evidence must include every opportunity and response reference")
        if not all(turns[number]["speaker"] == "user" for number in finding.responseTurnNumbers):
            raise ValueError("Opportunity responses must reference learner turns")
        opportunities = finding.opportunityTurnNumbers
        invalid_responses = [number for number in finding.responseTurnNumbers if number <= min(opportunities)]
        if invalid_responses:
            later_learner_turns = sorted(
                number for number, turn in turns.items() if turn["speaker"] == "user" and number > min(opportunities)
            )
            raise ValueError(
                "Every missed-opportunity response must be later than an opportunity; "
                f"opportunityTurnNumbers={opportunities}, responseTurnNumbers={finding.responseTurnNumbers}, "
                f"invalid response sequences={invalid_responses}, later learner sequences={later_learner_turns}. "
                "Use an actual earlier opportunity and a later learner response, both cited in evidence. "
                "If the transcript ends before a learner response to that opportunity, remove the omission finding; "
                "use findings=[] when no other assessed findings remain; the server derives not_assessed. "
                "Never use the same turn as both opportunity and response or invent a response."
            )

    @staticmethod
    def _require_turn(number: int, turns: dict[int, dict[str, Any]]) -> None:
        if number not in turns:
            raise ValueError(
                f"Evidence turnNumber must match a supplied transcript sequence; valid sequences: {sorted(turns)}"
            )

    @staticmethod
    def _require_exact_keys(actual: list[str], expected: set[str], label: str) -> None:
        if len(actual) != len(expected) or set(actual) != expected:
            missing = sorted(expected - set(actual))
            unknown = sorted(set(actual) - expected)
            duplicate = sorted(key for key, count in Counter(actual).items() if count > 1)
            # Unknown model-generated strings need not be echoed into diagnostics.
            raise ValueError(
                f"Return each supplied {label} exactly once: expected={sorted(expected)}, "
                f"missing={missing}, duplicate_count={len(duplicate)}, unknown_count={len(unknown)}"
            )


class GeneratedPerformedFinding(EvaluationObject):
    id: RuleId
    kind: Literal["demonstrated", "attempted"]
    behaviorId: RuleId
    rationale: NonEmptyText
    behaviorEvidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)
    contextEvidence: list[GeneratedEvaluationEvidence]


class GeneratedMissedFinding(EvaluationObject):
    id: RuleId
    kind: Literal["opportunity_missed"]
    behaviorId: RuleId
    rationale: NonEmptyText
    opportunityEvidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)
    responseEvidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)
    contextEvidence: list[GeneratedEvaluationEvidence]


class GeneratedCriticalCommission(EvaluationObject):
    id: RuleId
    kind: Literal["critical_error"]
    criticalErrorId: RuleId
    rationale: NonEmptyText
    behaviorEvidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)
    contextEvidence: list[GeneratedEvaluationEvidence]


class GeneratedCriticalOmission(EvaluationObject):
    id: RuleId
    kind: Literal["critical_error"]
    criticalErrorId: RuleId
    rationale: NonEmptyText
    opportunityEvidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)
    responseEvidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)
    contextEvidence: list[GeneratedEvaluationEvidence]


# A plain union emits provider-supported anyOf, without a discriminator/oneOf.
GeneratedEvaluationFinding = (
    GeneratedPerformedFinding | GeneratedMissedFinding | GeneratedCriticalCommission | GeneratedCriticalOmission
)


class GeneratedCompetencyAssessment(EvaluationObject):
    # Status is determined by findings, so the model must not choose it independently.
    competencyCode: str
    findings: list[GeneratedEvaluationFinding]


class GeneratedUnraisedObjectionOutcome(EvaluationObject):
    key: str
    status: Literal["not_raised"]
    evidence: list[GeneratedEvaluationEvidence] = Field(max_length=0)


class GeneratedRaisedObjectionOutcome(EvaluationObject):
    key: str
    status: Literal["handled", "partially_handled", "not_handled"]
    evidence: list[GeneratedEvaluationEvidence] = Field(min_length=1)


GeneratedObjectionOutcome = GeneratedUnraisedObjectionOutcome | GeneratedRaisedObjectionOutcome


class GeneratedEvaluationOutput(EvaluationObject):
    # Summary and finding rules are validated together by EvaluationOutput after
    # resolving evidence references to the transcript; the model never copies quotes.
    # One explicit decision per supplied key; the server derives both wire arrays.
    insightDiscovery: dict[str, bool]
    objectiveOutcome: Literal["achieved", "partially_achieved", "not_achieved"] | None
    objectiveEvidence: list[GeneratedEvaluationEvidence]
    objectionOutcomes: list[GeneratedObjectionOutcome]
    competencyAssessments: list[GeneratedCompetencyAssessment]

    @classmethod
    def request_json_schema(cls, request: EvaluationRequest) -> dict[str, Any]:
        schema = cls.model_json_schema()
        insight_keys = [item["key"] for item in request.agentConfig.get("hiddenInsights", [])]
        schema["properties"]["insightDiscovery"] = {
            "type": "object",
            "properties": {key: {"type": "boolean"} for key in insight_keys},
            "required": insight_keys,
            "additionalProperties": False,
        }
        # Put the practice's count and keys into generation constraints;
        # validate uniqueness and completeness again after generation.
        for array_name, item_names, key_field, keys in [
            (
                "objectionOutcomes",
                ["GeneratedUnraisedObjectionOutcome", "GeneratedRaisedObjectionOutcome"],
                "key",
                [item["key"] for item in request.agentConfig.get("objections", [])],
            ),
            (
                "competencyAssessments",
                ["GeneratedCompetencyAssessment"],
                "competencyCode",
                [item["code"] for item in request.competencies],
            ),
        ]:
            schema["properties"][array_name].update(minItems=len(keys), maxItems=len(keys))
            if keys:
                for item_name in item_names:
                    schema["$defs"][item_name]["properties"][key_field]["enum"] = keys
        sequences = sorted({turn["sequence"] for turn in request.turns})
        learner_sequences = sorted({turn["sequence"] for turn in request.turns if turn["speaker"] == "user"})
        eligible_opportunities = [
            number for number in sequences if any(response > number for response in learner_sequences)
        ]
        eligible_responses = [
            number for number in learner_sequences if any(opportunity < number for opportunity in sequences)
        ]
        evidence_schema = schema["$defs"]["GeneratedEvaluationEvidence"]
        if sequences:
            evidence_schema["properties"]["turnNumber"]["enum"] = sequences
        else:
            schema["properties"]["objectiveEvidence"]["maxItems"] = 0
        if not any(turn["speaker"] == "assistant" for turn in request.turns):
            schema["properties"]["objectionOutcomes"]["items"] = {"$ref": "#/$defs/GeneratedUnraisedObjectionOutcome"}

        collection_sequences = {
            "behaviorEvidence": learner_sequences,
            "opportunityEvidence": eligible_opportunities,
            "responseEvidence": eligible_responses,
            "contextEvidence": sequences,
        }
        finding_requirements = {
            "GeneratedPerformedFinding": learner_sequences,
            "GeneratedMissedFinding": eligible_opportunities,
            "GeneratedCriticalCommission": learner_sequences,
            "GeneratedCriticalOmission": eligible_opportunities,
        }
        viable_findings = []
        for finding_name, allowed in finding_requirements.items():
            properties = schema["$defs"][finding_name]["properties"]
            for collection, numbers in collection_sequences.items():
                if collection not in properties:
                    continue
                if numbers:
                    # Shared definitions state each turn enum once, however many finding
                    # variants and competencies reference it; strict output caps enum values.
                    name = f"Generated{collection[0].upper()}{collection[1:]}"
                    if name not in schema["$defs"]:
                        items = deepcopy(evidence_schema)
                        items["properties"]["turnNumber"]["enum"] = numbers
                        schema["$defs"][name] = items
                    properties[collection]["items"] = {"$ref": f"#/$defs/{name}"}
                elif collection == "contextEvidence":
                    properties[collection]["maxItems"] = 0
            if allowed:
                viable_findings.append(finding_name)
        # One assessment variant per competency scopes behaviorId and criticalErrorId
        # to that rubric, so the model cannot cite a level id, an invented id or
        # another competency's rule.
        base_assessment = schema["$defs"].pop("GeneratedCompetencyAssessment")
        keep_base_findings = not request.competencies
        assessment_variants = []
        for index, competency in enumerate(request.competencies):
            rubric = competency["rubric"]
            rule_ids = {
                "behaviorId": [item["id"] for item in rubric["behaviors"]],
                "criticalErrorId": [item["id"] for item in rubric["criticalErrors"]],
            }
            scoped_findings = []
            for finding_name in viable_findings:
                definition = deepcopy(schema["$defs"][finding_name])
                rule_field = next(field for field in rule_ids if field in definition["properties"])
                if not rule_ids[rule_field]:
                    continue
                definition["properties"][rule_field]["enum"] = rule_ids[rule_field]
                schema["$defs"][f"{finding_name}_{index}"] = definition
                scoped_findings.append({"$ref": f"#/$defs/{finding_name}_{index}"})
            assessment = deepcopy(base_assessment)
            assessment["properties"]["competencyCode"]["enum"] = [competency["code"]]
            findings = assessment["properties"]["findings"]
            if scoped_findings:
                findings["items"] = {"anyOf": scoped_findings}
            else:
                # Keep valid anyOf item schemas: only the enclosing array is empty.
                findings["maxItems"] = 0
                keep_base_findings = True
            schema["$defs"][f"GeneratedCompetencyAssessment_{index}"] = assessment
            assessment_variants.append({"$ref": f"#/$defs/GeneratedCompetencyAssessment_{index}"})
        if assessment_variants:
            schema["properties"]["competencyAssessments"]["items"] = {"anyOf": assessment_variants}
        else:
            schema["$defs"]["GeneratedCompetencyAssessment"] = base_assessment
        if not keep_base_findings:
            for finding_name in finding_requirements:
                del schema["$defs"][finding_name]
        return schema

    def to_evaluation_output(self, request: EvaluationRequest) -> EvaluationOutput:
        turns = {item["sequence"]: item for item in request.turns}

        def resolve_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            for item in items:
                EvaluationOutput._require_turn(item["turnNumber"], turns)
                # Quote the full source turn verbatim, including ASR spelling,
                # punctuation and whitespace. Empty turns have no quotation.
                item["quote"] = turns[item["turnNumber"]]["text"] or None
            return items

        data = self.model_dump()
        insight_keys = [item["key"] for item in request.agentConfig.get("hiddenInsights", [])]
        discoveries = data.pop("insightDiscovery")
        # Missing decisions are invalid, never silently converted to missed insights.
        EvaluationOutput._require_exact_keys(list(discoveries), set(insight_keys), "insight keys")
        data["discoveredInsightKeys"] = [key for key in insight_keys if discoveries[key]]
        data["missedInsightKeys"] = [key for key in insight_keys if not discoveries[key]]
        data["objectiveEvidence"] = resolve_evidence(data["objectiveEvidence"])
        for outcome in data["objectionOutcomes"]:
            status = outcome.pop("status")
            outcome["raised"] = status != "not_raised"
            outcome["handling"] = status if outcome["raised"] else None
            outcome["evidence"] = resolve_evidence(outcome["evidence"])
            buyer_turns = [
                item["turnNumber"]
                for item in outcome["evidence"]
                if turns[item["turnNumber"]]["speaker"] == "assistant"
            ]
            if (
                status in {"handled", "partially_handled"}
                and buyer_turns
                and not any(turn["speaker"] == "user" and number > min(buyer_turns) for number, turn in turns.items())
            ):
                # The call ended before the learner could respond, so nothing was
                # handled; regenerating cannot produce the learner evidence.
                outcome["handling"] = "not_handled"
        for assessment_index, assessment in enumerate(data["competencyAssessments"]):
            kinds = {finding["kind"] for finding in assessment["findings"]}
            if kinds.intersection({"demonstrated", "attempted", "critical_error"}):
                assessment["assessmentStatus"] = "observed"
            elif "opportunity_missed" in kinds:
                assessment["assessmentStatus"] = "opportunity_missed"
            else:
                assessment["assessmentStatus"] = "not_assessed"
            for finding_index, finding in enumerate(assessment["findings"]):
                # Collections declare each reference once. Preserve every item,
                # including repeated anchors, in the unchanged wire evidence.
                finding["evidence"] = []
                finding["behaviorId"] = finding.get("behaviorId")
                finding["criticalErrorId"] = finding.get("criticalErrorId")
                for collection, reference_field in [
                    ("behaviorEvidence", None),
                    ("opportunityEvidence", "opportunityTurnNumbers"),
                    ("responseEvidence", "responseTurnNumbers"),
                    ("contextEvidence", None),
                ]:
                    items = resolve_evidence(finding.pop(collection, []))
                    for item in items:
                        if collection in {"behaviorEvidence", "responseEvidence"} and (
                            turns[item["turnNumber"]]["speaker"] != "user"
                        ):
                            label = "Behavior" if collection == "behaviorEvidence" else "Response"
                            raise ValueError(
                                f"competencyAssessments.{assessment_index}.findings.{finding_index}: "
                                f"{label} evidence must reference learner turns"
                            )
                    finding["evidence"].extend(items)
                    if reference_field is not None:
                        finding[reference_field] = list(dict.fromkeys(item["turnNumber"] for item in items))
        output = EvaluationOutput.model_validate(data)
        output.validate_references(request)
        return output
