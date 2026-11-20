# API AltyDetect v1

L'API donne accès, depuis vos propres outils, aux mêmes analyses que l'application : détection de texte généré par IA (moteur Veritas) et plagiat (moteur Indexa). Elle est incluse dans l'offre Pro et utilise le quota mensuel de mots de votre compte.

> Un détecteur donne une probabilité, pas une preuve. Ce résultat doit être croisé avec d'autres éléments avant toute décision.

## Authentification

Créez une clé dans **Compte → Clés d'API**. Elle commence par `alty_` et n'est affichée qu'une fois. Envoyez-la dans l'en-tête `Authorization` :

```http
Authorization: Bearer alty_…
```

Jusqu'à 5 clés actives par compte. Une clé révoquée cesse de fonctionner immédiatement.

## Détection — `POST /api/v1/detect`

```bash
curl https://altydetect.com/api/v1/detect \
  -H "Authorization: Bearer $ALTYDETECT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "…au moins 150 mots…", "language": "auto", "mode": "standard", "keep_text": false}'
```

| Champ       | Type                 | Par défaut  | Rôle                                                            |
| ----------- | -------------------- | ----------- | --------------------------------------------------------------- |
| `text`      | chaîne               | obligatoire | Texte à analyser, au moins 150 mots                             |
| `language`  | `auto`, `fr` ou `en` | `auto`      | Langue du texte                                                 |
| `mode`      | `standard` ou `deep` | `standard`  | Analyse standard ou approfondie                                 |
| `keep_text` | booléen              | `false`     | Conserver le texte dans votre historique (sinon, jamais stocké) |

Réponse `200` :

```json
{
  "overall": { "ai": 0.62, "undetermined": 0.14, "human": 0.24 },
  "confidence": "medium",
  "verdict_band": "likely_ai",
  "language": "fr",
  "sentences": [{ "start": 0, "end": 118, "score": 0.81, "band": "likely_ai" }],
  "signals": { "humanization": "none" },
  "engine": { "primary": "VRT-DET-FR-0.6" },
  "word_count": 1284,
  "analysisId": "…"
}
```

- `verdict_band` : `likely_ai` (« Probablement IA »), `undetermined` (« Indéterminé ») ou `likely_human` (« Probablement humain »).
- `confidence` : `high`, `medium` ou `low`.
- `sentences` : probabilité par phrase, avec les positions de début et de fin dans le texte.

## Plagiat — `POST /api/v1/plagiarism`, puis `GET /api/v1/plagiarism/{task_id}`

L'analyse de plagiat est asynchrone. La première requête répond `202` avec un identifiant de tâche :

```bash
curl https://altydetect.com/api/v1/plagiarism \
  -H "Authorization: Bearer $ALTYDETECT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "…", "scope": "web"}'
```

```json
{ "task_id": "plg_…", "status": "queued", "progress": 0 }
```

`scope` : `web` (pages publiques), `private` (votre base privée) ou `both`. Interrogez ensuite la tâche toutes les quelques secondes jusqu'à `status: "done"` :

```json
{
  "task_id": "plg_…",
  "status": "done",
  "progress": 100,
  "result": {
    "similarity": 0.18,
    "matches": [
      { "start": 120, "end": 410, "source_url": "https://…", "excerpt": "…", "score": 0.92 }
    ],
    "engine": "IDX-WEB-1.0"
  }
}
```

## Erreurs

| Code HTTP | `error`                 | Signification                                                       |
| --------- | ----------------------- | ------------------------------------------------------------------- |
| 400       | `INVALID_INPUT`         | Corps de requête invalide                                           |
| 401       | `INVALID_API_KEY`       | Clé absente, inconnue ou révoquée                                   |
| 402       | `UPGRADE_REQUIRED`      | Fonction incluse dans Pro                                           |
| 413       | `TEXT_TOO_LONG`         | Texte trop long : analysez-le par parties                           |
| 422       | `TEXT_TOO_SHORT`        | Moins de 150 mots : aucun score n'est fiable                        |
| 422       | `UNSUPPORTED_LANGUAGE`  | La détection n'est pas encore disponible pour la langue de ce texte |
| 429       | `QUOTA_EXCEEDED`        | Quota mensuel atteint ; `resetsAt` donne la date de remise à zéro   |
| 503       | `DETECTION_UNAVAILABLE` | Service momentanément indisponible ; vos mots sont rendus           |

Les mots d'une analyse qui échoue sont toujours rendus à votre quota.

## Données

Le texte envoyé n'est jamais stocké, sauf si vous demandez `keep_text: true`. Il n'entre dans aucun corpus d'entraînement sans votre consentement explicite, désactivé par défaut.
