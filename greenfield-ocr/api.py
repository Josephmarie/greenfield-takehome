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
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from greenfield_ocr.document_loader import load_as_png_base64
from greenfield_ocr.pipeline import process

ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif"}

app = FastAPI(title="Greenfield Cardiology OCR pipeline")

# The browser console calls this cross-origin; allow any origin (synthetic data).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health():
    return {"ok": True, "service": "greenfield-ocr", "key_loaded": bool(os.environ.get("ANTHROPIC_API_KEY"))}


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
