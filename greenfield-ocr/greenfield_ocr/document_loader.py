"""Turn any input document (PDF or image) into a base64-encoded PNG that the
vision model can read. Faxes arrive as image-only PDFs, so there is no text
layer to parse -- rasterizing and using vision is the correct path."""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image
from pdf2image import convert_from_path

MAX_EDGE = 2200  # downscale very large scans to keep payloads reasonable


def _encode_png(img: Image.Image) -> str:
    img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, MAX_EDGE / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def load_as_png_base64(path: str | Path) -> str:
    """Return the first page of the document as a base64 PNG string."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pages = convert_from_path(str(path), dpi=200)
        if not pages:
            raise ValueError(f"No pages found in {path}")
        return _encode_png(pages[0])
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif"}:
        return _encode_png(Image.open(path))
    raise ValueError(f"Unsupported file type: {suffix}")
