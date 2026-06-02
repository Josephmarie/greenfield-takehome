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
import tempfile
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from greenfield_ocr.document_loader import load_as_png_base64
from greenfield_ocr.pipeline import process

ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif"}
DATABASE_URL = os.environ.get("DATABASE_URL")

app = FastAPI(title="Greenfield Cardiology OCR pipeline")

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
            conn.commit()
    except Exception as exc:  # don't crash boot if the DB is briefly unreachable
        print(f"[init_db] could not initialize fax_runs: {exc}")


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
    return {"ok": True, "service": "greenfield-ocr",
            "key_loaded": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "db_configured": bool(DATABASE_URL)}


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
