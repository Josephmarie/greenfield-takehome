"""End-to-end pipeline: one document in, a decision out."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Optional

from . import extract as extract_mod
from .deny_back import generate_deny_back
from .document_loader import load_as_png_base64
from .schemas import Classification
from .validate import validate

CLASSIFY_THRESHOLD = 0.85


@dataclass
class PipelineResult:
    source: str
    classification: dict
    extracted: Optional[dict] = None
    review_queue: list = field(default_factory=list)
    deny_back_letter: Optional[str] = None
    pushed_downstream: bool = False
    halt_reason: Optional[str] = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, default=str)


def process(path: str) -> PipelineResult:
    image = load_as_png_base64(path)

    cls: Classification = extract_mod.classify(image)
    result = PipelineResult(source=str(path), classification=cls.model_dump())

    if not cls.doc_type or cls.confidence < CLASSIFY_THRESHOLD:
        result.halt_reason = (
            f"classification confidence {cls.confidence:.2f} below "
            f"{CLASSIFY_THRESHOLD}; routed to human review"
        )
        return result

    raw = extract_mod.extract_raw(image, cls.doc_type)
    model, review = validate(raw, cls.doc_type)
    result.extracted = model.model_dump()
    result.review_queue = review

    if cls.doc_type == "referral":
        letter = generate_deny_back(model)
        if letter:
            result.deny_back_letter = letter
            result.pushed_downstream = False
            result.halt_reason = "referral missing required fields; deny-back generated"
        else:
            result.pushed_downstream = True
    else:
        # Insurance + lab: push only if nothing needs human review.
        result.pushed_downstream = len(review) == 0

    return result
