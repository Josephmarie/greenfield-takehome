"""Static prompt text and tool schemas.

These strings are deliberately constant across every document of a given type.
That makes them the natural prompt-cache boundary: the schema + instructions
are the large stable prefix, the document image is the small variable suffix.
See README "Prompt caching" and extract.py for where cache_control is applied.
"""

CLASSIFY_PROMPT = """You are a medical fax intake classifier for a cardiology practice.

Classify the attached document as exactly one of:
  - "referral"        (a consultation / referral request from another provider)
  - "insurance_card"  (a member's insurance card or benefits summary)
  - "lab_result"      (a laboratory report with test values)

Respond with ONLY a JSON object, no prose, no markdown fences:
{"doc_type": "referral|insurance_card|lab_result", "confidence": 0.0-1.0, "reasoning": "one short sentence"}
"""

# Shared extraction rules. Identical for every document -> fully cacheable.
EXTRACTION_RULES = """You extract structured data from a single medical fax for a cardiology practice.

Rules, in priority order:
1. NEVER guess or infer a value. If a field is blank, illegible, or absent,
   set value=null. A field printed as "[FIELD LEFT BLANK]" or left empty is null.
2. For every field you DO fill, copy the exact supporting text from the document
   into source_quote, verbatim. If you cannot point to text, the value is null.
3. confidence reflects only how clearly the source text reads:
     high   = printed clearly and unambiguously
     medium = readable but smudged, handwritten, or partially obscured
     low    = barely legible or requires interpretation
4. Also return full_transcription: a faithful, verbatim transcription of all
   text on the page. This is used to verify your field quotes downstream.
5. Do not normalize or reformat values. Transcribe what is on the page.
"""

REFERRAL_TOOL = {
    "name": "record_referral",
    "description": "Record every field extracted from a referral document.",
    "input_schema": {
        "type": "object",
        "properties": {
            "full_transcription": {"type": "string"},
            **{
                f: {
                    "type": "object",
                    "properties": {
                        "value": {"type": ["string", "null"]},
                        "source_quote": {"type": ["string", "null"]},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "notes": {"type": ["string", "null"]},
                    },
                    "required": ["value", "source_quote", "confidence"],
                }
                for f in [
                    "patient_name", "dob", "phone", "insurance_carrier", "member_id",
                    "group_number", "referring_provider_name", "referring_provider_npi",
                    "reason_for_referral", "urgency",
                ]
            },
        },
        "required": ["full_transcription"],
    },
}

INSURANCE_TOOL = {
    "name": "record_insurance_card",
    "description": "Record every field extracted from an insurance card / benefits summary.",
    "input_schema": {
        "type": "object",
        "properties": {
            "full_transcription": {"type": "string"},
            **{
                f: {
                    "type": "object",
                    "properties": {
                        "value": {"type": ["string", "null"]},
                        "source_quote": {"type": ["string", "null"]},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "notes": {"type": ["string", "null"]},
                    },
                    "required": ["value", "source_quote", "confidence"],
                }
                for f in [
                    "member_name", "member_id", "group_number",
                    "payer_id", "copay_specialist", "effective_date",
                ]
            },
        },
        "required": ["full_transcription"],
    },
}

LAB_TOOL = {
    "name": "record_lab_result",
    "description": "Record header fields and every analyte from a laboratory report.",
    "input_schema": {
        "type": "object",
        "properties": {
            "full_transcription": {"type": "string"},
            **{
                f: {
                    "type": "object",
                    "properties": {
                        "value": {"type": ["string", "null"]},
                        "source_quote": {"type": ["string", "null"]},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "notes": {"type": ["string", "null"]},
                    },
                    "required": ["value", "source_quote", "confidence"],
                }
                for f in ["patient_name", "dob", "ordering_provider_name", "report_date"]
            },
            "test_values": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "value": {"type": ["string", "null"]},
                        "unit": {"type": ["string", "null"]},
                        "reference_range": {"type": ["string", "null"]},
                        "lab_reported_flag": {"type": ["string", "null"]},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "source_quote": {"type": ["string", "null"]},
                    },
                    "required": ["name", "value", "reference_range", "confidence"],
                },
            },
        },
        "required": ["full_transcription", "test_values"],
    },
}

TOOLS = {
    "referral": REFERRAL_TOOL,
    "insurance_card": INSURANCE_TOOL,
    "lab_result": LAB_TOOL,
}
