# AltyDetect

Espace de travail textuel en quatre modules : **Détecter**, **Plagiat**, **Réécrire**, **Écrire**.
Les règles du dépôt sont dans [`CLAUDE.md`](./CLAUDE.md).

## Structure

| Dossier     | Contenu                                                      |
| ----------- | ------------------------------------------------------------ |
| `apps/web`  | Next.js : interface, API applicative, passerelle publique    |
| `packages/` | Modules TypeScript (core, detect, rewrite, billing…)         |
| `services/` | Services Python FastAPI : `veritas` (IA), `indexa` (plagiat) |
| `ml/`       | Corpus, entraînement, évaluation                             |
| `infra/`    | Docker, Modal, migrations, CI                                |
| `docs/`     | PRD, ADR, fiches des modèles                                 |

## Prérequis

Node 22+, pnpm 10, Python 3.12, uv, Docker.

## Démarrer

```bash
pnpm install
uv sync --all-packages
uv run pre-commit install
cp .env.example .env
docker compose up -d        # PostgreSQL 16 + pgvector, Redis
pnpm -C apps/web dev        # http://localhost:3000
```

Services Python :

```bash
uv run --package veritas uvicorn veritas.main:app --port 8001
uv run --package indexa uvicorn indexa.main:app --port 8002
```

## Vérifier

```bash
pnpm check   # Prettier, ESLint, vocabulaire, TypeScript, Vitest, Ruff, mypy, pytest
```
