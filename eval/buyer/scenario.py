"""Explicit projection of draft scenarios; never read grading annotations."""

from copy import deepcopy


def runtime_input(case: dict, offering: dict, locale: str) -> dict:
    # Future datasets can store full production-shaped scenario inputs directly.
    if "prompt_input" in case:
        return deepcopy(case["prompt_input"])
    persona = case["persona"]
    buyer = {
        "name": persona["name"],
        "addressTerm": persona["address_term"],
        "age": persona["age"],
        "occupation": persona["occupation"],
        "familySituation": persona["family_situation"],
        "motivation": {"detail": persona["motivation"]},
        "decisionMaker": {"detail": persona["decision_role"]},
        "budget": {"max": persona["budget_max_vnd"], "currency": "VND"},
        "priorities": persona["priorities"],
        "emotionalState": persona["emotional_state"],
        "communicationStyle": persona["communication_style"],
    }
    recollection = case["public_context"] + "\n" + "\n".join(case["buyer_known_product_facts"])
    config = {
        "kind": case["call_type"],
        "buyer": buyer,
        "privateBackground": case["private_background"],
        "recollection": recollection,
        "hiddenInsights": [
            {
                "key": insight["key"],
                "insight": insight["insight"],
                "revealGuidance": "Được tiết lộ khi: "
                + " ".join(insight["reveal_when"])
                + " Không tiết lộ khi: "
                + " ".join(insight["do_not_reveal_when"]),
            }
            for insight in case["hidden_insights"]
        ],
        "objections": [
            {
                "key": objection["key"],
                "sampleWording": objection["sample_wording"],
                "raiseGuidance": objection["raise_when"],
                "resolutionGuidance": objection["resolution_guidance"],
            }
            for objection in case["objections"]
        ],
        "behaviorRules": case.get("behavior_rules", []),
    }
    if case["call_type"] == "warm_call":
        config["sinceLastContact"] = case.get(
            "since_last_contact", "Không có thay đổi được xác lập ngoài lịch sử hội thoại."
        )
    # A supplied pickup line is a conversation fact, not a reference answer.
    history = case["conversation_history"]
    if history[0]["speaker"] == "buyer":
        config["openingLine"] = history[0]["text"]
    price = offering["price"]
    price_notes = {key: value for key, value in price.items() if key != "amount_vnd"}
    import json

    mapped_offering = {
        "productType": offering["product_type"],
        "projectName": offering["project_name"],
        "developer": offering.get("developer"),
        "location": offering["location"],
        "unit": {
            **{key: value for key, value in offering["unit"].items() if key != "area_m2"},
            "areaM2": offering["unit"]["area_m2"],
        },
        "price": {
            "amount": price["amount_vnd"],
            "currency": "VND",
            "note": json.dumps(price_notes, ensure_ascii=False),
        },
        "paymentPlan": {
            "summary": offering["payment_plan"]["summary"],
            "loanSupport": offering["payment_plan"].get("loan_support"),
            "promotions": [offering["payment_plan"]["promotion"]] if "promotion" in offering["payment_plan"] else [],
        },
        "handover": offering.get("handover"),
        "legalStatus": offering.get("legal_status"),
        "keyStrengths": offering["strengths"],
        "keyWeaknesses": offering["weaknesses"],
    }
    if "as_of" in offering:
        # The prompt anchors handover and payment dates to this month.
        mapped_offering["asOf"] = offering["as_of"]
    if "rental_reference" in offering:
        # Preserve every reference fact without masquerading as buyer knowledge.
        mapped_offering["rentalReference"] = offering["rental_reference"]
    return {
        "practice": {"type": case["call_type"], "locale": locale},
        "config": config,
        "learnerBrief": {"previousInteractions": case.get("previous_interactions", [])},
        "offering": mapped_offering,
    }


def generation_fixture(case: dict, offering: dict, locale: str) -> dict:
    # Reconnect history is separate from ordinary current-call chat history.
    return {
        "case_id": case["case_id"],
        "runtime": runtime_input(case, offering, locale),
        "previous_turns": case.get("previous_turns", []),
    }
