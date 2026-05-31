"""Deny-back letter generation.

A referral that is missing any required field is NOT pushed downstream.
Instead we generate a letter back to the referring provider naming each
missing item specifically, so they know exactly what to resubmit.
"""

from __future__ import annotations

from datetime import date

from .schemas import REQUIRED_REFERRAL_FIELDS, ReferralExtraction

PRACTICE_NAME = "Greenfield Cardiology"
PRACTICE_ADDRESS = "450 Market Street, Suite 300, San Francisco, CA 94105"
PRACTICE_PHONE = "415-555-0120"
PRACTICE_FAX = "415-555-0121"


def missing_required(referral: ReferralExtraction) -> list[str]:
    """Human-readable labels of required fields that are absent or unverified.

    A field counts as missing if it has no value OR its confidence is not
    high (we will not forward a referral on a guessed identifier)."""
    missing = []
    for key, label in REQUIRED_REFERRAL_FIELDS:
        field = getattr(referral, key)
        if (not field.is_present) or field.confidence != "high":
            missing.append(label)
    return missing


def generate_deny_back(referral: ReferralExtraction) -> str | None:
    missing = missing_required(referral)
    if not missing:
        return None

    patient = referral.patient_name.value or "the referred patient"
    dob = f" (DOB {referral.dob.value})" if referral.dob.is_present else ""
    provider = referral.referring_provider_name.value or "Referring Provider"
    bullets = "\n".join(f"  - {item}" for item in missing)

    return f"""{PRACTICE_NAME}
{PRACTICE_ADDRESS}
Phone: {PRACTICE_PHONE}  |  Fax: {PRACTICE_FAX}
Date: {date.today():%m/%d/%Y}

To: {provider}
Re: Incomplete referral - {patient}{dob}

Thank you for your referral. We are unable to process it as received because
the following required field(s) are missing or could not be verified:

{bullets}

Please resubmit the referral with the item(s) above completed and we will
schedule the patient promptly. If you have questions, contact our referral
coordinator at {PRACTICE_PHONE}.

This referral has been held and was not entered into scheduling.

{PRACTICE_NAME}
Referral Coordination
"""
