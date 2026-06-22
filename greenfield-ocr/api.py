"""FastAPI wrapper around the fax-intake OCR pipeline.

Exposes the same logic as the CLI over HTTP so the web console (and any other
client) can POST a document and get back the full pipeline decision: the
classification, extracted fields, human-review queue, and — for incomplete
referrals — the generated deny-back letter.

    pip install -r requirements.txt
    uvicorn api:app --host 0.0.0.0 --port 8000

    curl -F file=@examples/Fax-Referral.pdf http://localhost:8000/process

ANTHROPIC_API_KEY must be set in the environment (the pipeline calls Claude
vision for classification + extraction).
"""

from __future__ import annotations

import os
import secrets
import tempfile
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from greenfield_ocr.auth import (
    TokenError,
    decode_token,
    hash_password,
    make_token,
    verify_password,
)
from greenfield_ocr.document_loader import load_as_png_base64
from greenfield_ocr.pipeline import process

ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif"}
DATABASE_URL = os.environ.get("DATABASE_URL")

# ── auth + lead-capture config ───────────────────────────────────────────────
# JWT signing secret. A random per-boot fallback keeps dev working, but set a
# stable JWT_SECRET in production so tokens survive restarts.
JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_urlsafe(32)
JWT_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days

# Google Sheet that mirrors every signup as a sales lead (best-effort; the DB is
# always the source of truth). Set GOOGLE_SHEET_ID and share the sheet with the
# service-account email. Reuses the same credential file the voice agent mounts.
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID")
GOOGLE_SHEET_TAB = os.environ.get("GOOGLE_SHEET_TAB", "Leads")
GOOGLE_SHEET_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
# GOOGLE_CREDENTIALS_PATH lets you point at wherever the creds actually landed
# (e.g. a non-standard Render secret-file path); the standard locations follow.
GOOGLE_CRED_PATHS = [p for p in [
    os.environ.get("GOOGLE_CREDENTIALS_PATH"),
    "/etc/secrets/google_credentials.json",
    os.path.join(os.path.dirname(__file__), "google_credentials.json"),
] if p]


def _google_creds_path() -> Optional[str]:
    """First existing service-account credentials file, or None."""
    return next((p for p in GOOGLE_CRED_PATHS if os.path.exists(p)), None)
LEAD_COLUMNS = [
    "created_at", "name", "email", "org_name", "role",
    "org_type", "size", "interest", "phone", "user_id",
]

app = FastAPI(title="Pareto Health OCR pipeline")

# The browser console calls this cross-origin; allow any origin (synthetic data).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Postgres persistence (fax_runs) ──────────────────────────────────────────
def _conn():
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="Database not configured (DATABASE_URL unset).")
    return psycopg2.connect(DATABASE_URL)


# Password hashing + JWT live in greenfield_ocr.auth (stdlib-only, unit-tested
# offline). These thin wrappers bind the app's configured secret/TTL.
def issue_token(user_id: str, email: str) -> str:
    return make_token(user_id, email, JWT_SECRET, JWT_TTL_SECONDS)


def current_user(authorization: Optional[str] = Header(None)) -> dict:
    """FastAPI dependency: require a valid Bearer token, return its claims."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    try:
        return decode_token(authorization.split(" ", 1)[1].strip(), JWT_SECRET)
    except TokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc


# ── Google Sheets lead mirror (best-effort) ──────────────────────────────────
def _append_lead_to_sheet(lead: dict) -> None:
    """Append one lead as a row to the configured Google Sheet. Never raises —
    the Postgres write is the source of truth; the sheet is a convenience mirror."""
    if not GOOGLE_SHEET_ID:
        return
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        path = _google_creds_path()
        if not path:
            print(f"[leads] GOOGLE_SHEET_ID set but no credentials file found (looked in {GOOGLE_CRED_PATHS}); skipping sheet append.")
            return
        creds = service_account.Credentials.from_service_account_file(path, scopes=GOOGLE_SHEET_SCOPES)
        svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
        row = [str(lead.get(col, "") or "") for col in LEAD_COLUMNS]
        svc.spreadsheets().values().append(
            spreadsheetId=GOOGLE_SHEET_ID,
            range=f"{GOOGLE_SHEET_TAB}!A1",
            # RAW (not USER_ENTERED) so values are stored literally — otherwise a
            # phone like "+1 (424)…" or any leading +/=/-/@ is parsed as a formula.
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [row]},
        ).execute()
    except Exception as exc:  # connectivity / quota / sharing issues must not break signup
        print(f"[leads] could not append lead to Google Sheet: {exc}")


@app.on_event("startup")
def init_db():
    """Create the fax_runs table once on boot (idempotent)."""
    if not DATABASE_URL:
        return
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS fax_runs (
                    id uuid PRIMARY KEY,
                    user_id text,
                    uploaded_at timestamptz DEFAULT now(),
                    filename text,
                    doc_type text,
                    classification_confidence double precision,
                    extracted_fields jsonb,
                    review_queue jsonb,
                    deny_back_letter text,
                    pushed_downstream boolean
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id uuid PRIMARY KEY,
                    email text UNIQUE NOT NULL,
                    password_hash text NOT NULL,
                    name text,
                    created_at timestamptz DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS leads (
                    id uuid PRIMARY KEY,
                    user_id uuid REFERENCES users(id),
                    created_at timestamptz DEFAULT now(),
                    name text,
                    email text,
                    org_name text,
                    role text,
                    org_type text,
                    size text,
                    interest text,
                    phone text
                )
                """
            )
            conn.commit()
    except Exception as exc:  # don't crash boot if the DB is briefly unreachable
        print(f"[init_db] could not initialize tables: {exc}")


class RunIn(BaseModel):
    user_id: str
    filename: Optional[str] = None
    doc_type: Optional[str] = None
    classification_confidence: Optional[float] = None
    extracted_fields: Optional[Any] = None
    review_queue: Optional[Any] = None
    deny_back_letter: Optional[str] = None
    pushed_downstream: Optional[bool] = None


@app.post("/runs")
def create_run(run: RunIn):
    """Persist one OCR run and return its id."""
    rid = str(uuid.uuid4())
    Json = psycopg2.extras.Json
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO fax_runs
              (id, user_id, filename, doc_type, classification_confidence,
               extracted_fields, review_queue, deny_back_letter, pushed_downstream)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (rid, run.user_id, run.filename, run.doc_type, run.classification_confidence,
             Json(run.extracted_fields), Json(run.review_queue), run.deny_back_letter,
             run.pushed_downstream),
        )
        conn.commit()
    return {"id": rid}


@app.get("/runs")
def list_runs(user_id: str):
    """Return a user's past runs, newest first (full records for the dashboard)."""
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, user_id, uploaded_at, filename, doc_type, classification_confidence,
                   extracted_fields, review_queue, deny_back_letter, pushed_downstream
            FROM fax_runs WHERE user_id = %s ORDER BY uploaded_at DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    for r in rows:
        r["id"] = str(r["id"])
        r["uploaded_at"] = r["uploaded_at"].isoformat() if r.get("uploaded_at") else None
    return {"runs": rows}


@app.get("/")
def health():
    return {"ok": True, "service": "pareto-health-ocr",
            "key_loaded": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "db_configured": bool(DATABASE_URL),
            "sheet_configured": bool(GOOGLE_SHEET_ID),
            "sheet_creds_found": bool(_google_creds_path())}


# ── auth + lead capture ──────────────────────────────────────────────────────
class SignupIn(BaseModel):
    email: str
    password: str
    name: str
    org_name: str
    role: Optional[str] = None
    org_type: Optional[str] = None
    size: Optional[str] = None
    interest: Optional[str] = None
    phone: Optional[str] = None


class LoginIn(BaseModel):
    email: str
    password: str


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def _auth_response(user_id: str, email: str, name: Optional[str]) -> dict:
    return {"token": issue_token(user_id, email),
            "user": {"id": user_id, "email": email, "name": name}}


@app.post("/auth/signup")
def signup(body: SignupIn):
    email = _norm_email(body.email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=422, detail="Enter a valid work email.")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    if not body.name.strip() or not body.org_name.strip():
        raise HTTPException(status_code=422, detail="Name and organization are required.")

    uid = str(uuid.uuid4())
    lead_id = str(uuid.uuid4())
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="An account with that email already exists.")
        cur.execute(
            "INSERT INTO users (id, email, password_hash, name) VALUES (%s,%s,%s,%s)",
            (uid, email, hash_password(body.password), body.name.strip()),
        )
        cur.execute(
            """
            INSERT INTO leads
              (id, user_id, name, email, org_name, role, org_type, size, interest, phone)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (lead_id, uid, body.name.strip(), email, body.org_name.strip(), body.role,
             body.org_type, body.size, body.interest, body.phone),
        )
        conn.commit()

    # Mirror the lead to the sales Google Sheet (best-effort, never blocks signup).
    _append_lead_to_sheet({
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "name": body.name.strip(), "email": email, "org_name": body.org_name.strip(),
        "role": body.role, "org_type": body.org_type, "size": body.size,
        "interest": body.interest, "phone": body.phone, "user_id": uid,
    })
    return _auth_response(uid, email, body.name.strip())


@app.post("/auth/login")
def login(body: LoginIn):
    email = _norm_email(body.email)
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, password_hash, name FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
    if not row or not verify_password(body.password, row[1]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return _auth_response(str(row[0]), email, row[2])


@app.get("/auth/me")
def me(user: dict = Depends(current_user)):
    return {"id": user.get("sub"), "email": user.get("email")}


@app.post("/process")
async def process_document(file: UploadFile = File(...)):
    """Run one uploaded fax through the pipeline and return the full decision."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{suffix or 'unknown'}'. "
                   f"Allowed: {', '.join(sorted(ALLOWED_SUFFIXES))}",
        )

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured on the server.")

    data = await file.read()
    # The loader works off a filesystem path; persist to a temp file with the
    # original suffix so PDF vs. image routing stays correct.
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        result = process(tmp_path)
    except Exception as exc:  # surface pipeline failures as a clean 422
        raise HTTPException(status_code=422, detail=f"Pipeline failed: {exc}") from exc
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    payload = asdict(result)
    payload["source"] = file.filename  # report the uploaded name, not the temp path
    return payload
