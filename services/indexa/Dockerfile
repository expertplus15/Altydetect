# Image du service Indexa. Le worker RQ utilise la même image avec une autre commande :
#   /app/.venv/bin/rq worker indexa --url "$REDIS_URL"
# Image du service Indexa. À construire depuis la racine du dépôt :
#   docker build -f services/indexa/Dockerfile -t altydetect-indexa .
FROM python:3.12-slim

RUN pip install --no-cache-dir "uv>=0.11,<0.12"

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Fichiers de l'espace de travail uv, puis le service seul.
COPY pyproject.toml uv.lock .python-version ./
COPY services/indexa/pyproject.toml services/indexa/pyproject.toml
COPY services/indexa/src services/indexa/src

RUN uv sync --frozen --no-dev --package indexa --no-install-workspace \
 && uv sync --frozen --no-dev --package indexa

RUN useradd --create-home --uid 1000 app
USER app

EXPOSE 8002
CMD ["/app/.venv/bin/uvicorn", "indexa.main:app", "--host", "0.0.0.0", "--port", "8002"]
