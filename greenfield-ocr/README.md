# Greenfield Cardiology — Fax Intake OCR Pipeline

Given a fax (PDF or image), this pipeline:

1. **Classifies** it as `referral`, `insurance_card`, or `lab_result`.
2. **Extracts** the required fields for that type, each with a verbatim source
   quote and a confidence level.
3. **Validates** every value with deterministic rules that can only lower
   confidence, never raise it.
4. **Flags** anything missing or below threshold for human review — nothing is
   ever silently filled.
5. For a **referral missing required fields**, generates a **deny-back letter**
   naming each missing item and does **not** push the referral downstream.

## Why it's built this way

**OCR and extraction are separated from acceptance.** The model proposes
values; a deterministic layer disposes. The model returns, for every field, a
`value`, a verbatim `source_quote`, and a self-reported `confidence`. The
validation layer then independently:

- **grounds each quote** — the `source_quote` must actually appear in the
  page transcription, or the value is treated as possibly invented and
  downgraded to `low`;
- **enforces format rules** — NPI is exactly 10 digits, dates look like dates,
  identifiers are non-empty;
- **computes lab ranges itself** — in/out-of-range is derived from the
  reference range, not trusted from the lab's printed `H`/`L` flag. (The Robert
  Kim CBC has Neutrophils at 72% against a 50–70% range that the lab left
  unflagged; the pipeline catches it.)

Only `high`-confidence, validated fields pass. Everything else lands in the
human-review queue with a reason.

## Confidence, honestly

A model's self-reported confidence is weak evidence on its own — it can be
confidently wrong, and a hallucinated value can come with a hallucinated quote.
So confidence here is the *combination* of (a) the model's self-report, (b)
quote-grounding against the transcription, and (c) deterministic format rules.
For a production system the next step is an **independent OCR pass** (a second
model or a dedicated OCR engine) so the quote check cross-validates two sources
instead of one. That upgrade is noted in the reflection.

## Architecture

```
document ─▶ load_as_png_base64 ─▶ classify ─▶ extract (tool-use) ─▶ validate ─▶ decide
                                    (vision)     (vision + schema)   (rules)     │
                                                                                 ├─ referral incomplete ─▶ deny-back letter, held
                                                                                 ├─ review queue non-empty ─▶ human review
                                                                                 └─ clean ─▶ push downstream
```

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # needs poppler for pdf2image:
                                          #   macOS: brew install poppler
                                          #   ubuntu: apt-get install poppler-utils
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
python -m greenfield_ocr.cli process examples/Fax-Referral.pdf
python -m greenfield_ocr.cli process examples/Fax-InsuranceCard.pdf
python -m greenfield_ocr.cli process examples/Fax-LabResult.pdf
python -m greenfield_ocr.cli process examples/Fax-Referral.pdf --json-only
```

## Expected behavior on the three sample faxes

| Document | Outcome |
|---|---|
| `Fax-Referral.pdf` (James Patterson) | Group number and Referring provider NPI are blank → **deny-back letter** naming exactly those two; referral **held**, not scheduled |
| `Fax-InsuranceCard.pdf` (Maria Gonzalez, Cigna) | All six fields extracted (member ID `CIG-4471829304`, group `00456781`, payer `62308`, specialist co-pay `$60`, effective `01/01/2026`) → clean |
| `Fax-LabResult.pdf` (Robert Kim, CBC) | Header + all analytes; **Neutrophils 72% flagged out-of-range** despite no lab flag; the lab's own H/L values confirmed |

## Tests

```bash
pytest -v          # logic tests, no API key required
```

The tests use raw payloads shaped like the model's output, built from the three
real faxes, to prove the deny-back, the NPI rule, the lab range computation, and
quote-grounding all behave correctly — deterministically and offline.

## Auth & lead capture (GTM)

The FastAPI wrapper (`api.py`) also backs the web dashboard's real sign-up /
sign-in and captures every signup as a sales lead.

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/signup` | Create a user (PBKDF2-hashed password), record the onboarding answers as a `leads` row, mirror to Google Sheet, return a JWT |
| `POST` | `/auth/login` | Verify credentials, return a JWT |
| `GET` | `/auth/me` | Echo the caller's claims (requires `Authorization: Bearer <jwt>`) |

Three tables are created on boot (idempotent): `fax_runs`, `users`, `leads`.
Password hashing and the HS256 JWT live in `greenfield_ocr/auth.py` (stdlib
only — no extra deps) and are unit-tested offline in `tests/test_auth.py`.

**Lead → Google Sheet.** On signup the lead is always written to Postgres, and
*best-effort* appended as a row to a Google Sheet (failures are logged, never
block signup). To enable the sheet:

1. Reuse the voice agent's Google **service account** (or make one) and **enable
   the Google Sheets API** on its GCP project.
2. Create a Google Sheet, add a header row in tab `Leads`:
   `created_at, name, email, org_name, role, org_type, size, interest, phone, user_id`,
   and **share the sheet** (Editor) with the service-account email.
3. Mount the credentials JSON on the OCR service at
   `/etc/secrets/google_credentials.json` (same as the voice agent; a local
   `greenfield-ocr/google_credentials.json` also works) and set
   `GOOGLE_SHEET_ID` (the id from the sheet URL).

**Environment variables**

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude vision for the pipeline |
| `DATABASE_URL` | yes (prod) | Postgres for `fax_runs`, `users`, `leads` |
| `JWT_SECRET` | recommended | Stable JWT signing secret (a random per-boot value is used if unset, which invalidates tokens on restart) |
| `GOOGLE_SHEET_ID` | optional | Enables the Google Sheet lead mirror |
| `GOOGLE_SHEET_TAB` | optional | Sheet tab name (default `Leads`) |

`GET /` reports `db_configured` and `sheet_configured` so you can confirm wiring.

## Prompt caching

The extraction rules (`prompts.EXTRACTION_RULES`) and each tool schema are
constant across every document of a type, so they carry
`cache_control: {"type": "ephemeral"}`. The image is the only variable part of
the request. Across a batch the stable prefix is read from cache rather than
reprocessed. See `extract.py`.

## Layout

```
greenfield_ocr/
  document_loader.py   PDF/image -> base64 PNG
  prompts.py           static prompts + tool schemas (the cacheable prefix)
  classify.py          (in extract.py) document-type classification
  extract.py           vision extraction via tool-use, with caching
  validate.py          quote grounding, format rules, lab range computation
  deny_back.py         missing-field letter for referrals
  pipeline.py          orchestration + downstream decision
  cli.py               command line
schemas.py             typed models + required-field definitions
tests/                 offline logic tests
examples/              the three sample faxes
```
