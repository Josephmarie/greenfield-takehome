"""Tool backend for the Greenfield Cardiology Retell voice agent.

Deploy this anywhere with a public URL (Render free tier works) and point the
Retell function tools at the matching routes. All data is the synthetic KB.

    pip install fastapi uvicorn
    uvicorn backend:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Greenfield Cardiology tool backend")

ACCEPTED = {"aetna", "blue cross blue shield", "bcbs", "cigna", "united healthcare",
            "medicare", "medical", "medi-cal", "health net"}
NOT_ACCEPTED = {"kaiser", "kaiser permanente", "oscar", "covered california"}

LOCATIONS = {
    "sf": {"name": "San Francisco (Main)", "address": "450 Market Street, Suite 300, San Francisco, CA 94105", "phone": "415-555-0120", "hours": "Mon-Fri 8am-5pm PT"},
    "oakland": {"name": "Oakland (Satellite)", "address": "2800 Broadway, Suite 110, Oakland, CA 94611", "phone": "510-555-0234", "hours": "Mon-Fri 8am-5pm PT"},
}

PROVIDER_SCHEDULE = {
    "dr. chen": {"sf": ["Mon", "Wed", "Fri"], "oakland": ["Tue", "Thu"]},
    "dr. webb": {"sf": ["Tue", "Thu"]},
    "jennifer park": {"sf": ["Mon", "Tue", "Wed", "Thu", "Fri"]},
}

# in-memory referral attempt tracker (synthetic, single process)
CALLBACKS: dict[str, list[dict]] = {}


class InsuranceReq(BaseModel):
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


class AvailabilityReq(BaseModel):
    provider: str
    location: str = "sf"
    date_range: str | None = None
    appointment_type: str | None = None


@app.post("/check_availability")
def check_availability(req: AvailabilityReq):
    prov = req.provider.strip().lower()
    loc = "oakland" if "oak" in req.location.lower() else "sf"
    days = PROVIDER_SCHEDULE.get(prov, {}).get(loc, [])
    if not days:
        return {"slots": [], "message": f"{req.provider} does not see patients at that location."}
    # return two synthetic upcoming slots on valid days
    today = datetime.now()
    slots = []
    for i in range(1, 15):
        d = today + timedelta(days=i)
        if d.strftime("%a") in days:
            slots.append(f"{d:%A, %B %d} at 10:00 AM")
        if len(slots) == 2:
            break
    return {"provider": req.provider, "location": LOCATIONS[loc], "slots": slots}


class BookReq(BaseModel):
    patient_name: str
    dob: str
    provider: str
    location: str = "sf"
    slot: str
    reason: str | None = None


@app.post("/book_appointment")
def book_appointment(req: BookReq):
    loc = "oakland" if "oak" in req.location.lower() else "sf"
    conf = f"GC-{abs(hash(req.patient_name + req.slot)) % 100000:05d}"
    return {"confirmation_id": conf, "provider": req.provider,
            "location": LOCATIONS[loc], "slot": req.slot}


@app.post("/lookup_location")
def lookup_location(query: dict):
    q = (query.get("query") or "").lower()
    loc = "oakland" if "oak" in q else "sf"
    return LOCATIONS[loc]


class CallbackReq(BaseModel):
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

AGENT_ID = os.environ.get("RETELL_AGENT_ID")
FROM_NUMBER = os.environ.get("RETELL_FROM_NUMBER")


@app.post("/calls/web")
def create_web_call():
    """Mint a web-call token the browser SDK connects to."""
    call = _retell.call.create_web_call(agent_id=AGENT_ID)
    return {"access_token": call.access_token, "call_id": call.call_id}


class OutboundReq(BaseModel):
    to_number: str
    referral_id: str | None = None


@app.post("/calls/outbound")
def create_outbound_call(req: OutboundReq):
    """Dial a real phone from the console (the Scenario-4 referral callback)."""
    call = _retell.call.create_phone_call(
        from_number=FROM_NUMBER,
        to_number=req.to_number,
        override_agent_id=AGENT_ID,
        metadata={"referral_id": req.referral_id} if req.referral_id else None,
    )
    return {"call_id": call.call_id}


@app.get("/calls/{call_id}")
def get_call(call_id: str):
    """Poll status / transcript for the console to render live."""
    c = _retell.call.retrieve(call_id)
    return {"call_id": call_id, "status": getattr(c, "call_status", None),
            "transcript": getattr(c, "transcript", None)}
