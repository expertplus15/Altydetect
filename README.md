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
pnpm -C apps/web worker     # exports PDF et rétention de l'historique (BullMQ)
```

Services Python (API et workers RQ) :

```bash
uv run --package indexa uvicorn indexa.main:app --port 8002
uv run --package indexa rq worker indexa --url "$REDIS_URL"
uv run --package veritas uvicorn veritas.main:app --port 8001
```

En développement, sans contrat de fournisseur de détection, Veritas peut répondre avec un
fournisseur simulé (sans valeur de détection) : `DETECTION_PROVIDER=simulated` et
`VERITAS_ALLOW_SIMULATED=1`. Les jetons internes (`INDEXA_INTERNAL_TOKEN`,
`VERITAS_INTERNAL_TOKEN`) doivent être identiques côté web et côté service.

## Vérifier

```bash
pnpm check   # Prettier, ESLint, vocabulaire, TypeScript, Vitest, Ruff, mypy, pytest
pnpm contracts:check          # modèles Pydantic à jour avec les contrats zod
pnpm -C apps/web build && pnpm -C apps/web test:e2e   # parcours Playwright (services simulés)
pnpm benchmark:plagiarism     # rappel d'Indexa sur le jeu de test gelé
```

## Entraîner Veritas

Sur Modal, lancé par GitHub Actions (ADR-0009) : un commit sur `main` qui modifie
`ml/train/requests/run.json` démarre le workflow « Entraînement Veritas (Modal) » avec les
paramètres du fichier (`pilot` pour un essai isolé, `v1` pour les modèles 0.1, étape `deploy`
pour la couche 2). Fiches des modèles : `docs/models/`. Secrets du dépôt
nécessaires : `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `ANTHROPIC_API_KEY`.

## Mettre en production

Voir [`docs/deploiement.md`](./docs/deploiement.md) : Vercel (web), Neon (PostgreSQL), Upstash
(Redis), Railway (worker, Indexa, Veritas), Modal (couche 2 de Veritas).

## État

| Phase | Contenu                                                     | État                                                                                                                 |
| ----- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | Squelette SaaS, Réécrire, Écrire, i18n, Stripe              | Code livré ; porte : abonnement Pro en production                                                                    |
| 2     | Indexa (web + base privée), rapport PDF                     | Code livré ; rappel ≥ 90 % sur le jeu de test plagiat                                                                |
| 3     | Détection : fournisseur externe, Veritas FR/EN 0.1 en fond  | VRT-DET-FR/EN-0.1 livrés (couche 2 sur Modal) ; contrat fournisseur et activation du mode fantôme à faire (ADR-0010) |
| 4     | VRT-HUM, modèle multilingue, benchmark public, API publique | À venir                                                                                                              |
