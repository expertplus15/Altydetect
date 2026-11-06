# Image du service Veritas. À construire depuis la racine du dépôt :
#   docker build -f services/veritas/Dockerfile -t altydetect-veritas .
FROM python:3.12-slim

RUN pip install --no-cache-dir "uv>=0.11,<0.12"

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Fichiers de l'espace de travail uv, puis le service seul.
COPY pyproject.toml uv.lock .python-version ./
COPY services/veritas/pyproject.toml services/veritas/pyproject.toml
COPY services/veritas/src services/veritas/src
# Seuils et règles d'aiguillage, relus à chaud : montables en volume pour les modifier sans
# redéploiement (VERITAS_CONFIG_DIR).
COPY services/veritas/config services/veritas/config

RUN uv sync --frozen --no-dev --package veritas --no-install-workspace \
 && uv sync --frozen --no-dev --package veritas

RUN useradd --create-home --uid 1000 app
USER app

EXPOSE 8001
CMD ["/app/.venv/bin/uvicorn", "veritas.main:app", "--host", "0.0.0.0", "--port", "8001"]
