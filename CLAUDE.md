# AltyDetect — CLAUDE.md

Ce fichier est la constitution du dépôt. Claude Code le lit à chaque session. Toute règle ici prime sur les habitudes par défaut. Le PRD de référence est « AltyDetect — PRD v0.1 » ; ce fichier le traduit en règles de développement.

## 1. Ce qu'est le produit

AltyDetect (altydetect.com) est un SaaS d'espace de travail textuel à quatre modules : **Détecter** (texte IA), **Plagiat**, **Réécrire**, **Écrire**. Marque ombrelle Alty. Produit commercial indépendant, self-service, cible grand public et professionnelle (étudiants, rédacteurs, agences, RH), plus une API publique en phase 4.

Deux moteurs propriétaires, chacun un package autonome :
- **Veritas** — détection IA. Références `VRT-[DET|HUM|PLG]-[FR|EN|ML]-x.y`.
- **Indexa** — plagiat. Références `IDX-[WEB|PRV]-x.y`.

Promesse produit non négociable : un résultat de détection est **une probabilité avec niveau de confiance et zone « indéterminé »**, jamais un verdict binaire.

## 2. Stack (ne pas dévier sans décision écrite)

| Couche | Choix |
| --- | --- |
| Front + API applicative | Next.js (App Router), TypeScript strict, React Server Components par défaut |
| UI | Tailwind CSS, composants maison (pas de bibliothèque de composants lourde), icônes Lucide |
| i18n | next-intl ; `fr` par défaut, `en` ; fichiers `apps/web/messages/{fr,en}.json` ; langue dans l'URL (`/fr`, `/en`, ADR-0002) |
| Auth | Auth.js (e-mail magic link + Google) |
| Base | PostgreSQL 16 + pgvector ; Prisma comme ORM côté Node |
| File de tâches | Redis ; BullMQ côté Node, RQ côté Python |
| Service ML | Python 3.12, FastAPI, Hugging Face Transformers, Pydantic v2 |
| Inférence GPU | Modal (par défaut) ou RunPod, à la demande, jamais de GPU permanent |
| LLM | API Claude via SDK officiel ; modèle fixé dans `config/llm.ts`, jamais en dur ailleurs |
| Paiement | Stripe (Checkout + Customer Portal + webhooks) |
| Stockage | S3 compatible (Cloudflare R2) |
| Observabilité | Sentry (front + back), métriques Prometheus côté FastAPI |
| Tests | Vitest + Playwright (Node) ; pytest (Python) |
| Qualité | ESLint, Prettier, Ruff, mypy strict ; pre-commit obligatoire |

## 3. Structure du dépôt (monorepo pnpm + uv)

```
altydetect/
  apps/
    web/                 # Next.js : interface, API applicative, API publique (passerelle)
  packages/
    core/                # types partagés, contrats d'API internes (zod), i18n keys
    detect/              # client TypeScript du service de détection (Veritas + externe)
    plagiarism/          # client TypeScript du service Indexa
    rewrite/             # module Réécrire : prompts, registres, orchestration LLM
    write/               # module Écrire : plan, correction, citations, résumé
    billing/             # Stripe, plans, quotas
    reports/             # génération PDF des rapports
  services/
    veritas/             # Python FastAPI : couches 1-3, aiguillage, adaptateur externe
    indexa/              # Python FastAPI : n-grammes, recherche web, alignement, base privée
  ml/
    corpus/              # scripts de constitution des corpus (jamais de données brutes commitées)
    train/               # fine-tuning, calibration
    eval/                # jeu de test gelé, benchmark, rapports
  infra/                 # Docker, Modal, migrations, CI
  docs/                  # PRD, ADR (décisions d'architecture), changelog des modèles
```

Règles de dépendance : `apps/web` dépend des `packages/*` ; les `packages/*` ne dépendent jamais de `apps/web` ; `services/veritas` et `services/indexa` ne se connaissent pas et ne partagent que `packages/core` via ses schémas JSON exportés.

## 4. Règles d'architecture

1. **Chaque module métier est un package indépendant** avec une API interne versionnée (`/internal/v1/...`). L'API publique (`/api/v1/...`) est une passerelle devant ces mêmes endpoints, jamais une réimplémentation.
2. **Veritas et Indexa sont déployables, facturables et exposables séparément.** Aucun import croisé.
3. **L'adaptateur de détection externe est une interface unique** (`DetectionProvider`) avec implémentations `CopyleaksProvider`, `GPTZeroProvider`, `PangramProvider`. Le fournisseur actif se choisit par variable d'environnement. Ajouter un fournisseur ne touche que `services/veritas/providers/`.
4. **L'aiguillage** (`services/veritas/router.py`) décide qui répond selon : langue, longueur, niveau de confiance de Veritas, plan de l'utilisateur, règles de bascule par segment lues depuis la configuration. Il enregistre toujours les deux avis quand les deux ont tourné, pour la comparaison.
5. **Le texte analysé n'est jamais écrit en base.** Il transite en mémoire et dans la file, puis est supprimé. Seuls les résultats agrégés sont persistés ; une copie du texte n'est conservée que si l'utilisateur l'a demandée explicitement (`keep_text: true`).
6. **Aucun appel LLM ni aucun appel fournisseur depuis un composant React.** Tout passe par les API internes.
7. **Toute chaîne visible passe par next-intl.** Aucune chaîne en dur dans un composant. La langue d'interface (`fr` par défaut, `en`) est indépendante de la langue du texte analysé, détectée automatiquement côté service.
8. **Les quotas sont vérifiés côté serveur** avant tout traitement, jamais seulement dans l'interface.
9. **Les analyses longues (fichiers, lots, PDF) passent par la file** ; la requête HTTP répond immédiatement avec un identifiant de tâche.

## 5. Contrats d'API internes (résumé — détail dans `packages/core/contracts/`)

### Détection — `POST /internal/v1/detect`
Entrée : `{ text, language?: 'auto'|'fr'|'en', mode: 'standard'|'deep', keep_text: false }`
Sortie :
```
{
  overall: { ai: 0.62, undetermined: 0.14, human: 0.24 },
  confidence: 'high'|'medium'|'low',
  verdict_band: 'likely_ai'|'undetermined'|'likely_human',
  language: 'fr',
  sentences: [{ start, end, score, band }],
  signals: { probable_model?: string, humanization: 'none'|'weak'|'strong' },
  engine: { primary: 'VRT-DET-FR-0.1'|'copyleaks'|..., secondary?: string, agreement?: number },
  word_count: 1284
}
```
Règles : `word_count < 150` → erreur `TEXT_TOO_SHORT`, jamais de score. `verdict_band` est calculé à partir de seuils de confiance définis dans `services/veritas/config/thresholds.yaml`, jamais codés en dur.

### Plagiat — `POST /internal/v1/plagiarism`
Entrée : `{ text, scope: 'web'|'private'|'both', workspace_id? }`
Sortie : `{ similarity: 0.18, matches: [{ start, end, source_url?, source_doc_id?, excerpt, score }], engine: 'IDX-WEB-1.0' }`

### Réécriture — `POST /internal/v1/rewrite`
Entrée : `{ text, register: 'academic'|'professional'|'simple'|'faithful', intensity: 1|2|3, preserve_citations: true, variants: 1..3 }`
Sortie : `{ variants: [{ text, changes_summary }] }`

Tous les contrats sont des schémas zod dans `packages/core` et des modèles Pydantic générés à partir des mêmes JSON Schemas. Un changement de contrat = une version (`v2`), jamais une modification silencieuse.

## 6. Veritas — règles ML

- Un modèle par langue au départ (`VRT-DET-FR`, `VRT-DET-EN`), multilingue ensuite (`ML`).
- Le jeu de test (`ml/eval/testset/`) est **gelé** : il ne reçoit jamais de données utilisées à l'entraînement. Toute modification du jeu de test crée une nouvelle version du jeu, documentée dans `docs/models/CHANGELOG.md`.
- Chaque modèle livré a une fiche dans `docs/models/` : référence, corpus, date, métriques (précision, rappel, taux de faux positifs sur textes humains FR et EN, latence), écart avec le fournisseur externe.
- Aucun texte d'utilisateur n'entre dans un corpus sans le drapeau de consentement `training_opt_in = true` sur le compte, désactivé par défaut.
- Les seuils de bascule de l'aiguillage vivent dans `services/veritas/config/routing.yaml` et sont modifiables sans redéploiement.
- Les données brutes des corpus ne sont jamais commitées ; seuls les scripts et les manifestes (hash, source, licence) le sont.

## 7. Vocabulaire produit (strict)

**Mots interdits** dans le code visible, l'interface, les métadonnées, le site, les e-mails, la documentation publique et les messages de commit publics : *contourner, bypass, indétectable, undetectable, tromper, passer les détecteurs, humanizer* (comme nom de fonction). Le module s'appelle **Réécrire** ; il « améliore le style, le registre et la clarté ».

**Formulations imposées** :
- Le résultat est « une probabilité », « un indice », jamais « une preuve » ni « un verdict ».
- L'encart sous le score : « Un détecteur donne une probabilité, pas une preuve. Ce résultat doit être croisé avec d'autres éléments avant toute décision. » (clé i18n `detect.disclaimer`).
- Les trois états : « Probablement IA », « Indéterminé », « Probablement humain ».

Un test lint (`scripts/lint-vocabulary.ts`) échoue si un mot interdit apparaît dans `apps/web/messages/`, `apps/web/app/` ou `docs/public/`.

## 8. Interface

- Structure en trois zones : barre latérale 220 px (outils, récents), zone centrale (éditeur unique, résultat en place), panneau de résultat 340–380 px.
- Fond clair, une seule couleur d'accent (`--accent`, bleu par défaut), Inter, aucune décoration. Les trois états diffèrent par la luminosité, pas seulement par la teinte : orange / gris / bleu.
- Sélecteur FR | EN dans l'en-tête ; préférence mémorisée sur le compte.
- Responsive : barre latérale repliée, panneau sous l'éditeur, tableaux larges en défilement horizontal. Cibles tactiles ≥ 44 px, contrastes ≥ 4,5:1, boutons et champs réels, `aria-label` sur les icônes.
- Paywall : quota visible dans l'en-tête, aucun blocage avant d'avoir vu le résultat, jamais « une seule utilisation gratuite ».
- Les maquettes de référence sont sur le canevas « AltyDetect — Maquettes » (Détecter, Réécrire, Tarifs).

## 9. Qualité et livraison

- **Tests obligatoires** pour tout endpoint interne, tout adaptateur fournisseur, toute règle de quota et toute règle de l'aiguillage. Les tests de l'aiguillage couvrent les quatre cas : Veritas seul, externe seul, les deux concordants, les deux discordants.
- Les appels fournisseurs et LLM sont **mockés** en test ; un test qui appelle une API payante est un bug.
- Couverture minimale : 80 % sur `packages/*` et `services/*`.
- Conventional Commits en français ou anglais, au choix, mais cohérent par PR. Préfixes : `feat`, `fix`, `refactor`, `test`, `docs`, `ml` (pour un modèle ou un corpus), `infra`.
- Une PR = une intention. Pas de refactor opportuniste dans une PR fonctionnelle.
- Toute décision d'architecture non triviale → un ADR dans `docs/adr/NNNN-titre.md` (contexte, décision, conséquences).
- Variables d'environnement documentées dans `.env.example` ; aucune clé réelle dans le dépôt, jamais, même en commentaire.

## 10. Ce que Claude Code doit faire et ne pas faire

**Faire**
- Lire ce fichier et le PRD avant toute tâche structurante.
- Proposer un plan court avant toute PR qui touche plus de trois packages.
- Écrire les tests avec le code, pas après.
- Poser une question quand un contrat d'API, un seuil ou un prix manque, plutôt que d'inventer une valeur. Les placeholders du PRD (`[PRIX PRO]`, `[QUOTA GRATUIT]`, `[SEUIL D'ACCORD]`…) restent des constantes nommées dans `config/` avec une valeur `TODO` explicite.
- Garder le français comme langue des commentaires de code et de la documentation interne ; l'anglais pour les identifiants de code.

**Ne pas faire**
- Introduire une dépendance lourde (bibliothèque UI, ORM alternatif, framework) sans ADR.
- Appeler un fournisseur externe ou un LLM depuis le front, un composant, ou un test.
- Stocker un texte analysé sans `keep_text: true`.
- Modifier le jeu de test ML sans nouvelle version documentée.
- Utiliser un mot du vocabulaire interdit, même dans un nom de variable visible.
- Contourner une vérification de quota côté serveur.
- Déployer un GPU permanent.

## 11. Feuille de route (rappel)

| Phase | Contenu | Porte de sortie |
| --- | --- | --- |
| 0 | Spécification, choix du fournisseur externe, dépôt initialisé | PRD validé, ADR-0001 (fournisseur) |
| 1 | Squelette SaaS + Réécrire + Écrire, i18n, Stripe | Un abonnement Pro peut être souscrit et résilié en production |
| 2 | Indexa (web + base privée), rapport PDF combiné | Rappel ≥ seuil sur le jeu de test plagiat, coût par document mesuré |
| 3 | Détection : externe en production, Veritas FR/EN 0.1 en arrière-plan | Accord ≥ seuil sur un segment, faux positifs < 1 % |
| 4 | VRT-HUM, VRT-DET-ML-1.0 sur les cas faciles, benchmark public, API publique | ≥ 50 % du trafic servi par Veritas, premier client API |

Commencer par la phase 1 : c'est le chemin le plus court vers un produit vendable.
