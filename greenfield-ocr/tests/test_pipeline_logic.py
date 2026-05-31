"""Logic tests that run without any API calls.

They use raw dicts shaped exactly like the model's tool output, built from the
three real fax documents in this exercise, to prove the deterministic layer
behaves correctly:

  - the referral (James Patterson) is missing Group number + Referring NPI,
    so a deny-back naming exactly those two must be generated;
  - the lab (Robert Kim) has Neutrophils 72 in a 50-70 range that the lab did
    NOT flag, which our range computation must catch independently.
"""

from greenfield_ocr.deny_back import generate_deny_back, missing_required
from greenfield_ocr.validate import validate


def _f(value, quote=None, conf="high"):
    return {"value": value, "source_quote": quote or value, "confidence": conf, "notes": None}


REFERRAL_RAW = {
    "full_transcription": (
        "CONSULTATION / REFERRAL REQUEST Referring Provider: Dr. Michael Torres, MD "
        "Practice: Bay Area Internal Medicine Group Patient Name: James Patterson "
        "Date of Birth: 04/22/1958 Phone: (415) 555-7892 Insurance Carrier: Aetna PPO "
        "Member ID: AET-992847162 Group Number: [FIELD LEFT BLANK] "
        "Reason for Referral: Exertional chest pain with shortness of breath "
        "Urgency: [X] ROUTINE Referring Provider NPI: [FIELD LEFT BLANK]"
    ),
    "patient_name": _f("James Patterson"),
    "dob": _f("04/22/1958"),
    "phone": _f("(415) 555-7892"),
    "insurance_carrier": _f("Aetna PPO"),
    "member_id": _f("AET-992847162"),
    "group_number": _f(None, quote=None, conf="low"),
    "referring_provider_name": _f("Dr. Michael Torres, MD"),
    "referring_provider_npi": _f(None, quote=None, conf="low"),
    "reason_for_referral": _f("Exertional chest pain with shortness of breath"),
    "urgency": _f("ROUTINE"),
}


def test_referral_deny_back_names_exactly_the_two_blanks():
    model, review = validate(REFERRAL_RAW, "referral")
    letter = generate_deny_back(model)
    assert letter is not None
    assert "Group number" in letter
    assert "Referring provider NPI" in letter
    # the eight present fields must NOT appear as missing
    assert "Patient name" not in letter
    assert "Reason for referral" not in letter
    missing = missing_required(model)
    assert set(missing) == {"Group number", "Referring provider NPI"}


def test_referral_not_pushed_when_incomplete():
    model, review = validate(REFERRAL_RAW, "referral")
    statuses = {item["field"]: item["status"] for item in review}
    assert statuses.get("group_number") == "missing"
    assert statuses.get("referring_provider_npi") == "missing"


def test_npi_format_rule_downgrades_bad_npi():
    raw = dict(REFERRAL_RAW)
    raw["referring_provider_npi"] = _f("12345", quote="NPI: 12345", conf="high")
    raw["full_transcription"] += " NPI: 12345"
    model, _ = validate(raw, "referral")
    assert model.referring_provider_npi.confidence == "low"


LAB_RAW = {
    "full_transcription": (
        "LABORATORY REPORT Quest Diagnostics PATIENT: Robert Kim Date of Birth: 11/03/1965 "
        "Ordering Provider: Dr. Sarah Chen, MD NPI 1234567890 Date Reported: 05/24/2026 "
        "WBC 11.2 [H] 4.5 - 11.0 K/uL Hemoglobin 12.8 [L] 13.5 - 17.5 g/dL "
        "Neutrophils 72 50 - 70 % Lymphocytes 18 [L] 20 - 40 %"
    ),
    "patient_name": _f("Robert Kim"),
    "dob": _f("11/03/1965"),
    "ordering_provider_name": _f("Dr. Sarah Chen, MD"),
    "report_date": _f("05/24/2026"),
    "test_values": [
        {"name": "WBC", "value": "11.2", "unit": "K/uL", "reference_range": "4.5 - 11.0",
         "lab_reported_flag": "H", "confidence": "high", "source_quote": "WBC 11.2 [H]"},
        {"name": "Hemoglobin", "value": "12.8", "unit": "g/dL", "reference_range": "13.5 - 17.5",
         "lab_reported_flag": "L", "confidence": "high", "source_quote": "Hemoglobin 12.8 [L]"},
        {"name": "Neutrophils", "value": "72", "unit": "%", "reference_range": "50 - 70",
         "lab_reported_flag": None, "confidence": "high", "source_quote": "Neutrophils 72"},
    ],
}


def test_lab_catches_unflagged_out_of_range_neutrophils():
    model, review = validate(LAB_RAW, "lab_result")
    neut = next(t for t in model.test_values if t.name == "Neutrophils")
    assert neut.in_range is False
    assert neut.computed_flag == "H"
    assert "lab flag was 'none'" in (neut.notes or "")
    out_of_range = {i["field"] for i in review if i["status"] == "out_of_range"}
    assert "lab:Neutrophils" in out_of_range
    assert "lab:WBC" in out_of_range


def test_quote_grounding_downgrades_invented_value():
    raw = dict(REFERRAL_RAW)
    raw["member_id"] = _f("AET-000000000", quote="Member ID: AET-000000000", conf="high")
    model, _ = validate(raw, "referral")
    # this quote is not in the transcription -> must be downgraded
    assert model.member_id.confidence == "low"
