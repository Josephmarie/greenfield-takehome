"""Data models for extracted documents.

Every field carries its own provenance and confidence so that nothing is
ever filled silently. A field is either:
  - extracted with a high confidence and a verbatim source quote, or
  - flagged for human review (low/medium confidence, failed validation), or
  - explicitly null (the field is genuinely absent from the document).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]
DocType = Literal["referral", "insurance_card", "lab_result"]


class ExtractedField(BaseModel):
    """A single extracted value with full provenance."""

    value: Optional[str] = None
    # The exact text from the document this value was read from. Used to
    # verify the model did not invent the value (see validate.verify_quote).
    source_quote: Optional[str] = None
    confidence: Confidence = "low"
    notes: Optional[str] = None

    @property
    def is_present(self) -> bool:
        return self.value is not None and str(self.value).strip() != ""


class TestValue(BaseModel):
    """A single lab analyte. in_range is computed locally, not trusted from
    the lab's own H/L flag (the lab can omit flags it should have set)."""

    name: str
    value: Optional[str] = None
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    lab_reported_flag: Optional[str] = None  # what the lab printed (H/L/None)
    computed_flag: Optional[str] = None       # what WE computed (H/L/normal)
    in_range: Optional[bool] = None
    confidence: Confidence = "low"
    source_quote: Optional[str] = None
    notes: Optional[str] = None


class Classification(BaseModel):
    doc_type: Optional[DocType] = None
    confidence: float = 0.0
    reasoning: Optional[str] = None


class ReferralExtraction(BaseModel):
    patient_name: ExtractedField = Field(default_factory=ExtractedField)
    dob: ExtractedField = Field(default_factory=ExtractedField)
    phone: ExtractedField = Field(default_factory=ExtractedField)
    insurance_carrier: ExtractedField = Field(default_factory=ExtractedField)
    member_id: ExtractedField = Field(default_factory=ExtractedField)
    group_number: ExtractedField = Field(default_factory=ExtractedField)
    referring_provider_name: ExtractedField = Field(default_factory=ExtractedField)
    referring_provider_npi: ExtractedField = Field(default_factory=ExtractedField)
    reason_for_referral: ExtractedField = Field(default_factory=ExtractedField)
    urgency: ExtractedField = Field(default_factory=ExtractedField)


class InsuranceCardExtraction(BaseModel):
    member_name: ExtractedField = Field(default_factory=ExtractedField)
    member_id: ExtractedField = Field(default_factory=ExtractedField)
    group_number: ExtractedField = Field(default_factory=ExtractedField)
    payer_id: ExtractedField = Field(default_factory=ExtractedField)
    copay_specialist: ExtractedField = Field(default_factory=ExtractedField)
    effective_date: ExtractedField = Field(default_factory=ExtractedField)


class LabResultExtraction(BaseModel):
    patient_name: ExtractedField = Field(default_factory=ExtractedField)
    dob: ExtractedField = Field(default_factory=ExtractedField)
    ordering_provider_name: ExtractedField = Field(default_factory=ExtractedField)
    report_date: ExtractedField = Field(default_factory=ExtractedField)
    test_values: list[TestValue] = Field(default_factory=list)


# ---- Required fields per type (drives deny-back + review flagging) ----

REQUIRED_REFERRAL_FIELDS: list[tuple[str, str]] = [
    ("patient_name", "Patient name"),
    ("dob", "Patient date of birth"),
    ("phone", "Patient phone number"),
    ("insurance_carrier", "Insurance carrier"),
    ("member_id", "Member ID"),
    ("group_number", "Group number"),
    ("referring_provider_name", "Referring provider name"),
    ("referring_provider_npi", "Referring provider NPI"),
    ("reason_for_referral", "Reason for referral"),
    ("urgency", "Urgency"),
]

REQUIRED_INSURANCE_FIELDS: list[tuple[str, str]] = [
    ("member_name", "Member name"),
    ("member_id", "Member ID"),
    ("group_number", "Group number"),
    ("payer_id", "Payer ID"),
    ("copay_specialist", "Co-pay (specialist)"),
    ("effective_date", "Effective date"),
]

EXTRACTION_MODELS = {
    "referral": ReferralExtraction,
    "insurance_card": InsuranceCardExtraction,
    "lab_result": LabResultExtraction,
}
