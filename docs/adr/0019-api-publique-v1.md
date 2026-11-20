# ADR-0019 — API publique v1 : passerelle par clé d'API, fermée tant que son prix n'est pas fixé

- **Statut** : accepté (20/11/2026) pour la partie technique. Le prix de l'API (`API_PRICE_PER_1000_WORDS_EUR`) et son quota inclus (`API_INCLUDED_WORDS_PER_MONTH`) restent à décider (`TODO` dans `packages/billing/src/config/plans.ts`).
- **Date** : 2026-11-20
- **Décideurs** : équipe AltyDetect
- **Suite de** : CLAUDE.md §4.1 (API publique = passerelle), §11 (phase 4 : premier client API)

## Contexte

La phase 4 demande une API publique et un premier client API. CLAUDE.md §4.1 fixe la règle : l'API publique (`/api/v1/...`) est une passerelle devant les endpoints internes, jamais une réimplémentation. Veritas et Indexa doivent être exposables séparément (§4.2).

Le prix de l'API n'est pas fixé (`[PRIX API]` du PRD). Le facturer sans prix, ou choisir un prix à la place de l'équipe, n'est pas possible (CLAUDE.md §10). Le code peut pourtant être prêt : clés, passerelle, quotas, documentation.

## Décision

### 1. Périmètre de la v1

| Méthode et chemin                  | Endpoint interne servi                 | Réponse                             |
| ---------------------------------- | -------------------------------------- | ----------------------------------- |
| `POST /api/v1/detect`              | `POST /internal/v1/detect`             | contrat de détection (CLAUDE.md §5) |
| `POST /api/v1/plagiarism`          | `POST /internal/v1/plagiarism`         | `202` et identifiant de tâche       |
| `GET /api/v1/plagiarism/{task_id}` | `GET /internal/v1/plagiarism/{taskId}` | état de la tâche, puis résultat     |

- Réécrire et Écrire ne sont pas exposés en v1 : leur coût est un appel au LLM par requête, sans prix d'API pour le couvrir.
- Les entrées, sorties et codes d'erreur sont **exactement** ceux des endpoints internes. Le mode approfondi et la base privée suivent les mêmes règles d'offre.

### 2. Passerelle, pas réimplémentation

Le traitement de chaque endpoint interne (validation, offre, quota, appel au service, historique, mots rendus en cas d'échec) est extrait dans une fonction serveur unique (`apps/web/lib/detect/run.ts`, `apps/web/lib/plagiarism/run.ts`). La route interne l'appelle avec l'utilisateur de la session ; la route publique, avec l'utilisateur de la clé. Aucune règle n'est écrite deux fois.

### 3. Clés d'API

- Format : `alty_` suivi de 32 caractères aléatoires (base 62, ≈ 190 bits).
- Stockage : seule l'empreinte SHA-256 de la clé est enregistrée, avec un préfixe affiché (`alty_` + 6 caractères) pour la reconnaître. La clé n'est montrée qu'une fois, à la création.
- Envoi : en-tête `Authorization: Bearer <clé>`.
- Au plus 5 clés actives par compte ; chacune a un nom, une date de dernière utilisation, et peut être révoquée. Une clé révoquée répond `401`.
- Gestion depuis la page Compte.

### 4. Accès fermé tant que le prix n'est pas fixé

- Variable `PUBLIC_API_ENABLED` : sans elle (ou différente de `true`), `/api/v1/*` répond `404` et la page Compte ne montre pas les clés. **Elle reste absente en production** jusqu'à la décision sur le prix.
- Une fois ouverte, la v1 est réservée aux comptes Pro et décompte le **même quota mensuel de mots** que l'interface (vérifié côté serveur, CLAUDE.md §4.8). C'est l'état de la bêta fermée ; la facturation propre à l'API viendra avec son prix, par un nouvel ADR.

### 5. Données

- Le texte n'est jamais stocké, sauf `keep_text: true` (CLAUDE.md §4.5), comme dans l'interface. Les analyses faites par l'API rejoignent l'historique du compte.
- Aucune clé n'est journalisée.

### 6. Documentation publique

`docs/public/api.md` : authentification, endpoints, exemples, erreurs, rappel qu'un résultat est une probabilité, pas une preuve. Elle passe par le contrôle du vocabulaire.

## Conséquences

- **Ce qui devient possible** : un premier client API en bêta dès que l'équipe ouvre l'accès, sans autre développement.
- **Ce qui devient plus difficile** : un changement de contrat interne devient un changement de l'API publique. Il suit déjà la règle des versions (CLAUDE.md §5 : `v2`, jamais de modification silencieuse).
- **Coût** : aucun coût nouveau ; un appel API coûte ce que coûte la même analyse dans l'interface.
- **Risques** : une clé divulguée consomme le quota du compte. Mitigations : révocation immédiate, date de dernière utilisation visible, limite de 5 clés.

**À revoir** : à la décision sur le prix de l'API (facturation à l'usage, quota inclus, plan Équipe).
