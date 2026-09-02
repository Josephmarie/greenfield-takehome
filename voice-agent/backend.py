"""Tool backend for the Greenfield Cardiology Retell voice agent.

Deploy this anywhere with a public URL (Render free tier works) and point the
Retell function tools at the matching routes. All data is the synthetic KB.

    pip install fastapi uvicorn
    uvicorn backend:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, model_validator


def _unwrap(body):
    """Retell posts tool calls as {"call":..., "name":..., "args":{...}}; direct
    callers post the params flat. Return the actual params dict either way."""
    if isinstance(body, dict):
        a = body.get("args")
        if isinstance(a, str):
            try:
                a = json.loads(a)
            except Exception:
                a = None
        if isinstance(a, dict):
            return a
    return body if isinstance(body, dict) else {}


class ToolReq(BaseModel):
    """Base for Retell tool request bodies — unwraps the Retell `args` envelope
    before validation, while still accepting a flat body (curl/tests)."""

    @model_validator(mode="before")
    @classmethod
    def _unwrap_args(cls, data):
        return _unwrap(data)

app = FastAPI(title="Greenfield Cardiology tool backend")

ACCEPTED = {"aetna", "blue cross blue shield", "bcbs", "cigna", "united healthcare",
            "medicare", "medical", "medi-cal", "health net"}
NOT_ACCEPTED = {"kaiser", "kaiser permanente", "oscar", "covered california"}

LOCATIONS = {
    "sf": {"name": "San Francisco (Main)", "address": "450 Market Street, Suite 300, San Francisco, CA 94105", "phone": "415-555-0120", "hours": "Mon-Fri 8am-5pm PT"},
    "oakland": {"name": "Oakland (Satellite)", "address": "2800 Broadway, Suite 110, Oakland, CA 94611", "phone": "510-555-0234", "hours": "Mon-Fri 8am-5pm PT"},
}

# Per location: which weekdays the provider is there, and the clinic-hours window
# (start/end hour, 24h) used to generate concrete appointment times.
PROVIDER_SCHEDULE = {
    "dr. chen": {
        "sf": {"days": ["Mon", "Wed", "Fri"], "start": 9, "end": 17},
        "oakland": {"days": ["Tue", "Thu"], "start": 10, "end": 16},
    },
    "dr. webb": {
        "sf": {"days": ["Tue", "Thu"], "start": 8, "end": 16},
    },
    "jennifer park": {
        "sf": {"days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "start": 8, "end": 12},
    },
}

# in-memory referral attempt tracker (synthetic, single process)
CALLBACKS: dict[str, list[dict]] = {}


class InsuranceReq(ToolReq):
    carrier: str
    member_id: str | None = None


@app.post("/verify_insurance")
def verify_insurance(req: InsuranceReq):
    c = req.carrier.strip().lower()
    if any(n in c for n in NOT_ACCEPTED):
        return {"accepted": False, "message": "We'll need to verify your coverage before confirming an appointment. Our team will follow up with you within one business day."}
    if any(a in c for a in ACCEPTED):
        return {"accepted": True, "message": f"{req.carrier} is accepted and in network."}
    return {"accepted": False, "message": "I'm not certain that plan is in network. Our team will verify and follow up within one business day."}


class AvailabilityReq(ToolReq):
    provider: str = ""          # optional so a partial call never 422s the agent
    location: str | None = "sf"
    date_range: str | None = None
    appointment_type: str | None = None


def _match_provider(name: str):
    """Map any phrasing of a provider's name ('Dr. Sarah Chen', 'Chen', 'Doctor
    Chen') to a PROVIDER_SCHEDULE key, so the schedule lookup doesn't miss."""
    n = (name or "").lower()
    if "webb" in n:
        return "dr. webb"
    if "chen" in n:
        return "dr. chen"
    if "park" in n:
        return "jennifer park"
    return None


PREFERRED_HOURS = [9, 10, 11, 14]  # 9am, 10am, 11am, 2pm


def _day_hours(start_h: int, end_h: int):
    """Up to 4 appointment hours within [start, end): the preferred set plus the
    office's opening hour (so early-opening clinics like 8am still get 8:00)."""
    hours = sorted(set(PREFERRED_HOURS + [start_h]))
    return [h for h in hours if start_h <= h < end_h][:4]


def _next_slots(sched: dict, days_count: int = 3, horizon: int = 35):
    """Return concrete appointment times (formatted strings) for the next
    `days_count` available days, with 3-4 times per day from the provider's
    clinic hours. Always forward-looking — never returns times already passed."""
    now = datetime.now()
    days = sched["days"]
    hours = _day_hours(sched["start"], sched["end"])
    out, filled_days = [], 0
    for i in range(horizon):
        d = now + timedelta(days=i)
        if d.strftime("%a") not in days:
            continue
        day_slots = [d.replace(hour=h, minute=0, second=0, microsecond=0).strftime("%A, %B %-d at %-I:%M %p")
                     for h in hours
                     if d.replace(hour=h, minute=0, second=0, microsecond=0) > now]
        if day_slots:
            out.extend(day_slots)
            filled_days += 1
        if filled_days >= days_count:
            break
    return out


@app.post("/check_availability")
def check_availability(req: AvailabilityReq):
    key = _match_provider(req.provider)
    loc = "oakland" if "oak" in (req.location or "").lower() else "sf"
    sched = (PROVIDER_SCHEDULE.get(key) or {}).get(loc)
    if not sched:
        # Provider doesn't work the requested office — offer their other office.
        other = "sf" if loc == "oakland" else "oakland"
        other_sched = (PROVIDER_SCHEDULE.get(key) or {}).get(other)
        if other_sched:
            return {"provider": req.provider, "location": LOCATIONS[other],
                    "slots": _next_slots(other_sched),
                    "message": f"{req.provider} isn't at our {LOCATIONS[loc]['name']} office, but here are the next openings at {LOCATIONS[other]['name']}."}
        return {"slots": [], "message": f"I couldn't find availability for {req.provider or 'that provider'} at that location."}
    return {"provider": req.provider, "location": LOCATIONS[loc], "slots": _next_slots(sched)}


# ── Google Calendar integration ──────────────────────────────────────────────
GOOGLE_CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID")
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar"]
APPT_DURATION_MIN = 30  # default duration for all appointment types
# Prefer the Render secret file in production; fall back to the local dev copy.
GOOGLE_CRED_PATHS = [
    "/etc/secrets/google_credentials.json",
    os.path.join(os.path.dirname(__file__), "google_credentials.json"),
]


def _calendar_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build as _gbuild
    path = next((p for p in GOOGLE_CRED_PATHS if os.path.exists(p)), None)
    if not path:
        raise RuntimeError("google_credentials.json not found (checked /etc/secrets and local).")
    creds = service_account.Credentials.from_service_account_file(path, scopes=GOOGLE_SCOPES)
    return _gbuild("calendar", "v3", credentials=creds, cache_discovery=False)


def _parse_slot(slot: str):
    """Best-effort parse of a human slot string ('Wednesday, June 03 at 10:00 AM')
    into a naive local datetime; Google handles the timezone via the event."""
    from dateutil import parser as _dtp
    now = datetime.now()
    base = now.replace(hour=10, minute=0, second=0, microsecond=0)
    try:
        dt = _dtp.parse((slot or "").replace(" at ", " "), default=base)
    except Exception:
        dt = base + timedelta(days=1)
    if dt < now - timedelta(days=1):  # slot strings omit the year; roll forward
        dt = dt.replace(year=dt.year + 1)
    return dt


class BookReq(ToolReq):
    patient_name: str
    dob: str | None = None
    provider: str
    location: str = "sf"
    slot: str
    reason: str | None = None
    phone: str | None = None
    insurance: str | None = None


@app.post("/book_appointment")
def book_appointment(req: BookReq):
    loc = "oakland" if "oak" in req.location.lower() else "sf"
    office = LOCATIONS[loc]
    address = office["address"]  # office address from the KB
    description = (
        f"Patient: {req.patient_name or ''}\n"
        f"DOB: {req.dob or ''}\n"
        f"Reason: {req.reason or ''}\n"
        f"Provider: {req.provider or ''}\n"
        f"Location: {address}\n"
        f"Phone: {req.phone or ''}\n"
        f"Insurance: {req.insurance or ''}"
    )
    start = _parse_slot(req.slot)
    end = start + timedelta(minutes=APPT_DURATION_MIN)
    event_body = {
        "summary": f"Appointment: {req.patient_name}",
        "description": description,
        "location": address,
        "start": {"dateTime": start.isoformat(), "timeZone": "America/Los_Angeles"},
        "end": {"dateTime": end.isoformat(), "timeZone": "America/Los_Angeles"},
    }
    if not GOOGLE_CALENDAR_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CALENDAR_ID not configured.")
    try:
        created = _calendar_service().events().insert(
            calendarId=GOOGLE_CALENDAR_ID, body=event_body).execute()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Calendar event creation failed: {exc}") from exc
    # Return the real Google Calendar event id as the confirmation number.
    return {"confirmation_id": created["id"], "provider": req.provider,
            "location": office, "slot": req.slot, "event_link": created.get("htmlLink")}


@app.post("/lookup_location")
def lookup_location(query: dict):
    q = (_unwrap(query).get("query") or "").lower()
    loc = "oakland" if "oak" in q else "sf"
    return LOCATIONS[loc]


class CallbackReq(ToolReq):
    referral_id: str
    outcome: str  # "answered" | "voicemail" | "no_answer"


@app.post("/log_callback_attempt")
def log_callback_attempt(req: CallbackReq):
    attempts = CALLBACKS.setdefault(req.referral_id, [])
    now = datetime.now()
    if attempts:
        hrs = (now - attempts[-1]["time"]).total_seconds() / 3600
        if hrs < 48 and req.outcome != "answered":
            return {"status": "too_soon", "next_eligible_time": (attempts[-1]["time"] + timedelta(hours=48)).isoformat(),
                    "attempt_number": len(attempts)}
    attempts.append({"time": now, "outcome": req.outcome})
    if req.outcome == "answered":
        return {"status": "reached", "attempt_number": len(attempts)}
    if len(attempts) >= 3:
        return {"status": "closed", "attempt_number": len(attempts),
                "note": "patient unreachable - 3 attempts; notify referring provider by fax"}
    return {"status": "open", "attempt_number": len(attempts),
            "next_eligible_time": (now + timedelta(hours=48)).isoformat()}


@app.post("/flag_for_clinical_review")
def flag_for_clinical_review(payload: dict):
    payload = _unwrap(payload)
    return {"ok": True, "flagged": payload.get("reason", "unspecified")}


# ── Call triggering for the web console ──────────────────────────────────────
# Lets the intake console start a browser web call or dial an outbound callback.
# The Retell API key stays here, server-side; the browser only ever receives a
# short-lived web-call access token.
#
#   pip install retell-sdk
#   export RETELL_API_KEY=...        RETELL_AGENT_ID=agent_...   (from provisioning)
#   export RETELL_FROM_NUMBER=+1415...   # a number you own on Retell
#
# Verify method names against the installed retell-sdk version before relying on this.

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to your console origin in production
    allow_methods=["*"], allow_headers=["*"],
)

try:
    from retell import Retell
    _retell = Retell(api_key=os.environ["RETELL_API_KEY"])
except Exception:               # keep the tool server usable without call creds
    _retell = None

AGENT_ID = os.environ.get("RETELL_AGENT_ID")                     # front desk (inbound)
OUTBOUND_AGENT_ID = os.environ.get("RETELL_OUTBOUND_AGENT_ID")   # outbound callback
KIOSK_AGENT_ID = os.environ.get("RETELL_KIOSK_AGENT_ID")         # lobby kiosk (web only)
# The practice's Twilio number, imported into Retell for outbound dialing.
FROM_NUMBER = os.environ.get("RETELL_FROM_NUMBER", "+14156504518")

# Named agents the browser can start a web call against.
#
# "kiosk" falls back to the front desk agent when RETELL_KIOSK_AGENT_ID is
# unset, so deploying this change with no new configuration behaves exactly as
# before. Nothing here can affect the PSTN path: the +1 415-650-4518 binding
# lives in Retell's own phone-number record, keyed on a literal agent id, and
# is reached only by setup_sip_trunk.py -- which must never be re-run.
AGENTS = {
    "front_desk": AGENT_ID,
    "outbound": OUTBOUND_AGENT_ID or AGENT_ID,
    "kiosk": KIOSK_AGENT_ID or AGENT_ID,
}


class WebCallReq(BaseModel):
    agent: str | None = None            # "front_desk" (default) | "outbound" | "kiosk"
    metadata: dict | None = None        # attached to the call record
    dynamic_variables: dict | None = None  # {{template}} values for the prompt


@app.get("/healthz")
def healthz():
    """Cheap liveness target.

    The kiosk pings this every few minutes while idle to keep the free-tier
    instance from sleeping, so a visitor never waits out a 30-60s cold start.
    Rendering /docs (the current health check path) for that would be wasteful.
    """
    return {"ok": True}


@app.post("/calls/web")
def create_web_call(req: WebCallReq | None = None):
    """Mint a web-call token the browser SDK connects to.

    Body is optional: {"agent": "front_desk"|"outbound"|"kiosk"}. Defaults to
    front desk. metadata / dynamic_variables are only forwarded when supplied,
    so existing callers that send neither are unaffected.
    """
    key = (req.agent if req else None) or "front_desk"
    agent_id = AGENTS.get(key) or AGENT_ID
    kwargs = {"agent_id": agent_id}
    if req and req.metadata:
        kwargs["metadata"] = req.metadata
    if req and req.dynamic_variables:
        # Retell requires string values for prompt template variables.
        kwargs["retell_llm_dynamic_variables"] = {
            k: str(v) for k, v in req.dynamic_variables.items()
        }
    call = _retell.call.create_web_call(**kwargs)
    return {"access_token": call.access_token, "call_id": call.call_id, "agent": key}


class OutboundReq(BaseModel):
    to_number: str
    referral_id: str | None = None
    override_agent_id: str | None = None


@app.post("/calls/outbound")
def create_outbound_call(req: OutboundReq):
    """Dial a real phone from the console (the Scenario-4 referral callback)."""
    agent_id = req.override_agent_id or OUTBOUND_AGENT_ID or AGENT_ID
    try:
        call = _retell.call.create_phone_call(
            from_number=FROM_NUMBER,
            to_number=req.to_number,
            override_agent_id=agent_id,
            metadata={"referral_id": req.referral_id} if req.referral_id else None,
        )
    except Exception as exc:  # surface Retell errors (bad number, etc.) cleanly
        raise HTTPException(status_code=502, detail=f"Could not place call: {exc}") from exc
    return {"call_id": call.call_id, "from_number": FROM_NUMBER, "agent_id": agent_id}


@app.get("/calls/{call_id}")
def get_call(call_id: str):
    """Poll status / transcript for the console to render live."""
    c = _retell.call.retrieve(call_id)
    return {"call_id": call_id, "status": getattr(c, "call_status", None),
            "transcript": getattr(c, "transcript", None)}
