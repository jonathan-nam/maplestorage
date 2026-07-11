FROM python:3.12-slim

# opencv-python-headless still needs libGL's stub deps for its bundled wheels
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# One worker: the parse is ~0.5s of CPU and the task is CPU-bound, so
# concurrency buys nothing on a fractional-vCPU Fargate task.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1"]
