"""Validation and confidence adjustment.

The model's self-reported confidence is only the starting point. This layer
applies deterministic checks that can only ever *lower* confidence, never
raise it:

  - quote grounding: the field's source_quote must actually appear in the
    page transcription, otherwise the value may be invented -> downgrade.
  - format rules: NPI is 10 digits, dates look like dates, IDs are non-empty.
  - lab ranges: in/out-of-range is computed here from the reference range,
    not trusted from the lab's printed H/L flag.

Anything that ends up below the acceptance threshold (default: only "high"
passes) or is null is surfaced in the human-review queue. Nothing is ever
silently accepted.
"""

from __future__ import annotations

import re

from .schemas import (
    EXTRACTION_MODELS,
    ExtractedField,
    LabResultExtraction,
    TestValue,
)

ACCEPT = {"high"}  # confidence levels that pass without human review


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


def quote_is_grounded(quote: str | None, transcription: str) -> bool:
    """True if the quote can be located in the transcription (fuzzy)."""
    if not quote:
        return True  # nothing to verify (value is null)
    q, t = _norm(quote), _norm(transcription)
    if not t:
        return True  # no transcription to check against; don't penalize
    if q in t:
        return True
    # token-overlap fallback for minor OCR variance
    qt = [w for w in q.split() if len(w) > 2]
    if not qt:
        return q in t
    hits = sum(1 for w in qt if w in t)
    return hits / len(qt) >= 0.7


def _downgrade(field: ExtractedField, note: str) -> None:
    field.confidence = "low"
    field.notes = (field.notes + "; " if field.notes else "") + note


def _apply_field_rules(name: str, field: ExtractedField) -> None:
    if not field.is_present:
        return
    v = field.value.strip()
    if name == "referring_provider_npi" and not re.fullmatch(r"\d{10}", v):
        _downgrade(field, f"NPI must be 10 digits, got '{v}'")
    if name in {"dob", "effective_date", "report_date"}:
        if not re.search(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]+ \d{1,2},? \d{4}", v):
            _downgrade(field, f"does not look like a date: '{v}'")
    if name in {"member_id", "payer_id", "group_number"} and len(v) < 2:
        _downgrade(field, "identifier too short to be valid")


def _parse_range(rng: str | None):
    if not rng:
        return None
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)", rng)
    return (float(m.group(1)), float(m.group(2))) if m else None


def _compute_lab_flag(tv: TestValue) -> None:
    bounds = _parse_range(tv.reference_range)
    try:
        val = float(re.sub(r"[^\d.\-]", "", tv.value)) if tv.value else None
    except ValueError:
        val = None
    if bounds is None or val is None:
        tv.in_range = None
        tv.computed_flag = None
        return
    lo, hi = bounds
    if val < lo:
        tv.computed_flag, tv.in_range = "L", False
    elif val > hi:
        tv.computed_flag, tv.in_range = "H", False
    else:
        tv.computed_flag, tv.in_range = "normal", True
    # If the lab omitted a flag we computed, call it out.
    lab = (tv.lab_reported_flag or "").strip().upper().strip("[]")
    ours = "" if tv.computed_flag == "normal" else tv.computed_flag
    if ours and lab != ours:
        tv.notes = (tv.notes + "; " if tv.notes else "") + (
            f"out of range (computed {ours}) but lab flag was '{tv.lab_reported_flag or 'none'}'"
        )


def validate(raw: dict, doc_type: str):
    """Build the typed model, run all checks, and return (model, review_items)."""
    transcription = raw.get("full_transcription", "") or ""
    model_cls = EXTRACTION_MODELS[doc_type]

    if doc_type == "lab_result":
        header = {k: ExtractedField(**raw[k]) for k in
                  ["patient_name", "dob", "ordering_provider_name", "report_date"]
                  if isinstance(raw.get(k), dict)}
        tests = [TestValue(**t) for t in raw.get("test_values", [])]
        model = LabResultExtraction(test_values=tests, **header)
        for tv in model.test_values:
            if not quote_is_grounded(tv.source_quote, transcription):
                tv.confidence = "low"
                tv.notes = (tv.notes + "; " if tv.notes else "") + "quote not found in transcription"
            _compute_lab_flag(tv)
    else:
        fields = {k: ExtractedField(**v) for k, v in raw.items()
                  if isinstance(v, dict) and k != "full_transcription"}
        model = model_cls(**fields)

    # field-level checks for the header / flat-field documents
    for fname in model_cls.model_fields:
        attr = getattr(model, fname)
        if not isinstance(attr, ExtractedField):
            continue
        if not quote_is_grounded(attr.source_quote, transcription):
            _downgrade(attr, "quote not found in transcription")
        _apply_field_rules(fname, attr)

    review = build_review_queue(model, doc_type)
    return model, review


def build_review_queue(model, doc_type: str) -> list[dict]:
    """Every field that is missing or below threshold, with the reason."""
    items: list[dict] = []
    model_cls = EXTRACTION_MODELS[doc_type]
    for fname in model_cls.model_fields:
        attr = getattr(model, fname)
        if not isinstance(attr, ExtractedField):
            continue
        if not attr.is_present:
            items.append({"field": fname, "status": "missing", "reason": "no value found"})
        elif attr.confidence not in ACCEPT:
            items.append({"field": fname, "status": "review",
                          "reason": attr.notes or f"confidence={attr.confidence}",
                          "value": attr.value})
    if doc_type == "lab_result":
        for tv in getattr(model, "test_values", []):
            if tv.in_range is False:
                items.append({"field": f"lab:{tv.name}", "status": "out_of_range",
                              "reason": f"{tv.value} {tv.unit or ''} vs {tv.reference_range} ({tv.computed_flag})"})
            if tv.confidence not in ACCEPT:
                items.append({"field": f"lab:{tv.name}", "status": "review",
                              "reason": tv.notes or f"confidence={tv.confidence}"})
    return items
