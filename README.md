# Greenfield Cardiology — AI Intake Platform

An end-to-end AI platform for a cardiology practice's front desk, built as a take-home
for a Forward Deployed Engineer role. It has three parts that share one design language
and one deployment:

1. **Voice agent** — an AI receptionist that answers inbound calls and places outbound
   referral callbacks (scheduling, insurance, emergency triage), books real appointments
   on Google Calendar, and leaves PHI-free voicemails.
2. **OCR pipeline** — a fax-intake service that classifies and extracts referrals,
   insurance cards, and lab results with per-field confidence + source quotes, flags
   anything uncertain for human review, and generates deny-back letters for incomplete
   referrals.
3. **Web app** — a staff console that ties them together: an in-browser call to the
   agent, and a live fax-upload dashboard backed by Postgres.

All data is synthetic. No real PHI is used anywhere.

---

## Live demo

| Surface | Where | Notes |
| --- | --- | --- |
| **Phone (voice agent)** | **+1 (415) 650-4518** | Call it — schedule, ask about insurance, or say a red-flag symptom to trigger the 911 path. |
| **Web app** | **https://web-cortif-ai.vercel.app** | Reviewer login code: **`joseph-e430ee`** |
| **OCR service** | https://greenfield-ocr.onrender.com | `POST /process` (file upload), `POST /runs`, `GET /runs` |
| **Voice backend** | https://greenfield-voice-agent.onrender.com | Retell tool endpoints + `/calls/web`, `/calls/outbound` |

> The OCR and voice services run on Render's free tier, so the first request after a
> quiet period may take ~30–60s to wake. Each OCR upload makes a real Claude vision call.

In the web app, open **Dashboard** and upload any file from `greenfield-ocr/examples/`
(`Fax-Referral.pdf`, `Fax-InsuranceCard.pdf`, `Fax-LabResult.pdf`) to see the live
pipeline result; each run is saved and listed.

---

## Architecture

```
                         GREENFIELD CARDIOLOGY — AI INTAKE PLATFORM

  ┌─ PART 1 · VOICE ──────────────────────────────────────────────────────────────┐
  │                                                                                 │
  │  Caller ──PSTN──► Twilio ──Elastic SIP Trunk──► Retell AI ──► Claude Sonnet 4.6 │
  │  (phone)          +1 415-650-4518               (voice agent)  (reasoning+tools)│
  │                                                      │                          │
  │                                          HTTPS tool calls (args envelope)       │
  │                                                      ▼                          │
  │                                   voice-agent backend  (FastAPI · Render)       │
  │                                                      │                          │
  │                                                      ▼                          │
  │                                   Google Calendar  (service account)            │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─ PART 2 · OCR ────────────────────────────────────────────────────────────────┐
  │                                                                                 │
  │  Fax / image ──► OCR pipeline (FastAPI · Render · Docker+poppler)               │
  │                       │  classify → extract → validate → deny-back              │
  │                       │  Claude Sonnet 4.6 vision  (temperature 0, cached)      │
  │                       ▼                                                         │
  │                  PostgreSQL (Render)   ◄── POST /runs · GET /runs               │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─ PART 3 · WEB ────────────────────────────────────────────────────────────────┐
  │                                                                                 │
  │  Reviewer ──► Web app (Vite + React · Vercel)                                   │
  │                  ├── invite-code login                                          │
  │                  ├── in-browser call ──► voice-agent /calls/web ──► Retell      │
  │                  └── fax upload ───────► OCR /process  then  /runs (dashboard)  │
  └─────────────────────────────────────────────────────────────────────────────────┘

  Deploy: GitHub → Actions builds container images → ghcr.io → Render (voice + OCR)
          web/ → Vercel ·  Blueprint in render.yaml
```

---

## Part 1 — Voice agent

A [Retell AI](https://retellai.com) agent driven by **Claude Sonnet 4.6**, reachable on a
real phone number via a **Twilio Elastic SIP trunk**. The agent's tools are HTTP endpoints
in `voice-agent/backend.py`.

**Four scenarios it handles**

1. **Appointment scheduling** — collects the patient's details (spelling names back in NATO
   phonetic to avoid transcription errors), verifies insurance (`verify_insurance`), checks
   real provider availability (`check_availability`), and books the visit
   (`book_appointment`) — which creates a **real Google Calendar event** and returns its ID
   as the confirmation number.
2. **Emergency triage / override** — if a caller reports red-flag symptoms (e.g. "severe
   chest pain, left arm numb"), the agent advises **911 immediately in the first sentence**
   and **never** books an appointment for that call. This is the one behavior that must
   never regress.
3. **Insurance & general questions** — in-network checks against the synthetic carrier list,
   plus office locations/hours and "downtown" → which-office disambiguation
   (`lookup_location`).
4. **Outbound referral callbacks** — a separate agent calls referred patients back, up to
   **3 attempts 48h apart** (`log_callback_attempt`), and on voicemail leaves a strictly
   **PHI-free** message ("This is a message from Greenfield Cardiology, please call us
   back…") — no name, DOB, or clinical detail.

**SIP trunking.** The practice owns the Twilio number; `voice-agent/setup_sip_trunk.py`
wires an Elastic SIP trunk between Twilio and Retell so the number can both **receive**
inbound calls and **originate** outbound calls through the agent (see Design decisions).

**Google Calendar booking.** `book_appointment` authenticates with a Google **service
account** (`GOOGLE_CALENDAR_ID` + a credentials file mounted as a Render secret file at
`/etc/secrets/google_credentials.json`, with a local fallback) and writes an event titled
`Appointment: <name>` with a structured description, the office address as the location, and
a 30-minute default duration.

---

## Part 2 — OCR pipeline

A vision pipeline (`greenfield-ocr/`) that turns an image-only fax into a structured,
auditable decision. One document in, one decision out (`pipeline.py`):

1. **Classify** (`extract.py`) — Claude Sonnet 4.6 vision labels the page as `referral`,
   `insurance_card`, or `lab_result` with a confidence score. Below a 0.85 threshold the
   document is halted and routed to human review rather than guessed.
2. **Extract** — a per-type tool schema pulls each field as a structured object with a
   `value`, a **`confidence`** (`high` / `medium` / `low`), and a **`source_quote`** —
   the exact text on the page that justifies the value, so every field is traceable.
3. **Validate** (`validate.py`) — deterministic rules independent of the model: required
   fields present, lab values recomputed against their reference ranges (and flagged even
   when the lab itself printed no flag), and anything uncertain pushed to a human-review
   queue.
4. **Deny-back** (`deny_back.py`) — an incomplete **referral** is held (not scheduled) and a
   deny-back letter is generated naming exactly which required fields are missing.

**Prompt caching.** The static extraction rules and the per-type tool schema both carry
`cache_control: {"type": "ephemeral"}` and sit at the front of the request, ahead of the
only variable input (the page image). Across a batch the rules/schema are served from cache
(~90% cheaper on those tokens); the TTL can be raised to 3600s for production scale.

**Persistence.** `api.py` wraps the pipeline in FastAPI. `POST /process` runs one upload;
`POST /runs` saves the result to a Postgres `fax_runs` table (jsonb fields) and returns a
run id; `GET /runs?user_id=` powers the web dashboard.

Run the offline logic tests: `cd greenfield-ocr && pytest -v` (no API key required).

---

## Part 3 — Reflection

The full production-readiness write-up — evals & graders, prompt caching, and the
agent-tooling split — is in **[`reflection.pdf`](reflection.pdf)** (source:
[`reflection.md`](reflection.md)). In brief: ship safety-critical voice behavior behind
**automated eval gates** (binary safety checks, LLM-as-judge scenario replay, and
deterministic tool-trace assertions) that block any prompt change before it reaches a real
call; apply **prompt caching** at the two large static prefixes (OCR rules, voice system
prompt); and split work by task fit — autonomy for the well-specified OCR build,
human-in-the-loop for the safety-carrying prompts.

---

## Technical stack

| Area | Technologies |
| --- | --- |
| **Voice** | Retell AI, Claude Sonnet 4.6 (`claude-4.6-sonnet`), Twilio (number + Elastic SIP trunk), Google Calendar API (service account), FastAPI, Pydantic |
| **OCR** | Claude Sonnet 4.6 vision (`claude-sonnet-4-6`), Anthropic SDK (prompt caching), FastAPI, Pydantic, `pdf2image` + poppler, PostgreSQL, Typer (CLI), pytest |
| **Web** | Vite, React, `retell-client-js-sdk` (browser web calls), deployed on Vercel |
| **Infra** | Render (Docker web services + managed Postgres), container images built in GitHub Actions → ghcr.io, Vercel, `render.yaml` Blueprint |

---

## Local setup

Prereqs: Python 3.11+, Node 18+, and (for OCR) `poppler-utils` for PDF rasterization.

**OCR pipeline**
```bash
cd greenfield-ocr
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -v                                   # 5 offline logic tests, no API key

export ANTHROPIC_API_KEY=...                # required for live extraction
python -m greenfield_ocr.cli process examples/Fax-Referral.pdf   # CLI
uvicorn api:app --port 8000                 # HTTP API (POST /process, /runs)
```

**Voice backend**
```bash
cd voice-agent
pip install -r requirements.txt
uvicorn backend:app --host 0.0.0.0 --port 8000
```

**Web app**
```bash
cd web
npm install
npm run dev            # http://localhost:5173
```

**Environment variables** (names only — set your own values):

| Service | Variables |
| --- | --- |
| OCR | `ANTHROPIC_API_KEY`, `DATABASE_URL` (Postgres, optional locally), `GREENFIELD_MODEL` (optional override) |
| Voice | `RETELL_API_KEY`, `RETELL_AGENT_ID` (inbound), `RETELL_OUTBOUND_AGENT_ID`, `RETELL_FROM_NUMBER`, `GOOGLE_CALENDAR_ID`, plus a Google service-account file at `/etc/secrets/google_credentials.json` or `voice-agent/google_credentials.json` |
| Provisioning | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET` (SIP-trunk / number setup) |
| Web (build-time) | `VITE_CODE_JOSEPH`, `VITE_CODE_VARUNI` (invite codes) |

Secrets are never committed — `.env`, `.secrets.env`, and `google_credentials.json` are
gitignored.

---

## Design decisions

- **`temperature=0` for OCR.** Extraction is a structured, factual task — the same fax
  should always yield the same fields. Determinism makes the pipeline testable and the
  confidence scores meaningful, rather than introducing run-to-run drift.
- **SIP trunking over a plain webhook.** A Twilio voice webhook only handles inbound. An
  Elastic SIP trunk lets the practice's existing number both receive inbound calls and
  **originate outbound** referral callbacks through Retell, with native PSTN audio — the
  reliable path for a number that has to work in both directions.
- **Two separate Retell agents (inbound vs outbound).** The front desk and the referral-
  callback bot have genuinely different jobs, opening lines, and voicemail behavior. Keeping
  them as distinct agents (each with its own LLM/prompt) keeps each prompt focused and lets
  them evolve independently, instead of one overloaded agent branching on call direction.
- **Service account for Google Calendar.** Booking happens server-side with no human in the
  loop, so a service account (calendar shared with it as a writer) is the right fit — no
  per-user OAuth, no token refresh, and credentials delivered as a mounted secret file
  rather than baked into the image.
- **Container images to Render via Actions.** The repo is private and the Render workspace
  isn't its GitHub owner, so services deploy from images built in GitHub Actions and pushed
  to ghcr.io (the OCR image ships poppler) — reproducible builds without coupling Render to
  the repo.

---

## Repository layout

```
greenfield-takehome/
├── voice-agent/        # Part 1 — Retell tool backend, SIP-trunk + Retell provisioning
│   ├── backend.py            # FastAPI tool endpoints (+ Google Calendar booking)
│   ├── provision_retell.py   # create/update the Retell agents + LLMs
│   ├── setup_sip_trunk.py    # Twilio ⇄ Retell Elastic SIP trunk
│   └── retell_system_prompt.md
├── greenfield-ocr/     # Part 2 — OCR pipeline + FastAPI wrapper
│   ├── greenfield_ocr/       # classify · extract · validate · deny-back · pipeline
│   ├── api.py                # POST /process · /runs · GET /runs (Postgres)
│   └── examples/             # sample referral / insurance card / lab result
├── web/                # Part 3 — Vite + React staff console (Vercel)
├── reflection.pdf      # Part 3 — production-readiness write-up
└── render.yaml         # infrastructure-as-code (two web services)
```
