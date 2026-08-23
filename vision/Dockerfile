FROM python:3.12-slim

# opencv-python-headless still needs libGL's stub deps for its bundled wheels
# tesseract-ocr reads the character HUD (see app/cv/hud.py). It is the wrong
# tool for the stack counts (2/12) and the right one for the HUD's ~20px
# anti-aliased text, which it reads exactly.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# One worker: the parse is ~0.5s of CPU and the task is CPU-bound, so concurrency buys nothing.
#
# Binds 0.0.0.0, not 127.0.0.1. It used to share a network namespace with the backend, which
# reached it on loopback; it does not any more, so loopback would be reachable by nothing at all.
# Not a loosening: no `ports:` are published for it outside local development.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
