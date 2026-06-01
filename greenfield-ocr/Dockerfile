# OCR service image. Uses Debian + poppler-utils because document_loader.py
# rasterizes image-only fax PDFs via pdf2image (which shells out to pdftoppm).
# Render's native Python runtime has no poppler, so we ship our own.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects $PORT; default to 8000 for local `docker run`.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
