"""Mask personal identifiers in conversation text with regular expressions.

Catches identifiers with a fixed shape: emails, card numbers, Vietnamese phone
numbers and long digit runs (CCCD/CMND, bank accounts). Names, addresses and
numbers spoken as words still get through.
"""

import json
import re
from typing import Any

# Digits may be grouped the way STT writes them: "0912 345 678", "0912.345.678".
# Numbers are bounded by non-digits only, so "số0912345678" still matches.
_SEP = r"[ .-]?"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_CARD = re.compile(rf"(?<!\d)\d(?:{_SEP}\d){{12,18}}(?!\d)")
# Mobile (03/05/07/08/09 + 8 digits) and landline (02 + 9 digits), with 0, 84 or +84.
_PHONE = re.compile(rf"(?<![\d+])(?:\+?84{_SEP}|0)(?:[35789](?:{_SEP}\d){{8}}|2(?:{_SEP}\d){{9}})(?!\d)")
# CMND has 9 digits, CCCD 12, bank accounts usually 9 to 16. A bare 9+ digit
# amount like "500000000" is masked too.
_LONG_NUMBER = re.compile(r"(?<!\d)\d{9,}(?!\d)")


def _luhn_valid(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _mask_card(match: re.Match) -> str:
    digits = re.sub(r"\D", "", match.group())
    return "[CARD]" if _luhn_valid(digits) else match.group()


def redact_text(text: str) -> str:
    text = _EMAIL.sub("[EMAIL]", text)
    text = _CARD.sub(_mask_card, text)
    text = _PHONE.sub("[PHONE]", text)
    return _LONG_NUMBER.sub("[ID_NUMBER]", text)


def _redact_json(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [_redact_json(v) for v in value]
    if isinstance(value, dict):
        return {k: _redact_json(v) for k, v in value.items()}
    return value


def redact_serialized(text: str) -> str:
    """Mask a value that may be JSON, such as an LLM message list.

    Parsing first matters because ``json.dumps`` escapes Vietnamese letters to
    ``\\uXXXX``, and their hex digits can run into a phone number.
    """
    try:
        parsed = json.loads(text)
    except ValueError:
        return redact_text(text)
    if isinstance(parsed, list | dict):
        return json.dumps(_redact_json(parsed))
    # Plain text that happens to parse, like "500000000".
    return redact_text(text)
