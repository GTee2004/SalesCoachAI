import pytest

from src.salescoach_voice.redaction import redact_serialized, redact_text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Số em 0912345678 nha", "Số em [PHONE] nha"),
        ("gọi 0912 345 678 hoặc 0912.345.678", "gọi [PHONE] hoặc [PHONE]"),
        ("+84 912 345 678", "[PHONE]"),
        ("84912345678", "[PHONE]"),
        ("bàn 028 3823 4567", "bàn [PHONE]"),
        ("mail an.nguyen+test@mocato.vn nhé", "mail [EMAIL] nhé"),
        ("thẻ 4111 1111 1111 1111", "thẻ [CARD]"),
        ("thẻ 4111-1111-1111-1111", "thẻ [CARD]"),
        ("CCCD 079201001234", "CCCD [ID_NUMBER]"),
        ("CMND 025123456", "CMND [ID_NUMBER]"),
        ("tài khoản 19034567890123", "tài khoản [ID_NUMBER]"),
    ],
)
def test_masks_identifiers(text, expected):
    assert redact_text(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Giá 500 triệu, giảm 15%",
        "Giá 500.000.000 đồng",
        "Hẹn 16/10/2026 lúc 9 giờ",
        "Mã đơn 12345678",
        "Tầng 0912",
    ],
)
def test_leaves_ordinary_numbers(text):
    assert redact_text(text) == text


def test_non_luhn_grouped_digits_are_not_a_card():
    assert redact_text("1234 5678 9012 3456") == "1234 5678 9012 3456"


def test_json_messages_are_masked_inside_escaped_text():
    # json.dumps escapes "ố" to ố, whose digits would otherwise run into the phone number.
    serialized = '[{"role": "user", "content": "s\\u1ed10912345678"}]'
    assert redact_serialized(serialized) == '[{"role": "user", "content": "s\\u1ed1[PHONE]"}]'


def test_plain_text_that_parses_as_json_is_still_masked():
    assert redact_serialized("500000000") == "[ID_NUMBER]"
    assert redact_serialized('"0912345678"') == '"[PHONE]"'
