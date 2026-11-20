# Jeu de vérification `verification-fr-v1` (ADR-0018)

Mesure unique de VRT-DET-FR-0.6, à son seuil propre de 0,93, sur des textes réels, avant l'ouverture du français. Le jeu ne sert jamais à l'entraînement ni au choix d'un seuil. Seuls les manifestes (empreinte, catégorie, source, licence) sont commités ici, après la mesure ; les textes restent dans le volume Modal `altydetect-veritas-corpus`, dossier `verification-fr-v1/`.

Code : `ml/train/train/verification.py` (protocole `FR`, règles testées dans `ml/train/tests/test_verification_fr.py`) et `ml/train/pipeline.py` (étapes Modal, communes avec `verification-en-v1`).

## Contenu

| Catégorie         | Étiquette | Textes | Source                                                                                  |
| ----------------- | --------- | ------ | --------------------------------------------------------------------------------------- |
| `human_forum`     | humain    | 150    | Questions et réponses rédigées en français de French Language Stack Exchange (CC BY-SA 4.0) |
| `human_abstract`  | humain    | 350    | Résumés en français d'articles et de thèses HAL déposés de 2000 à 2021, sous CC BY, CC BY-SA ou CC0 |
| `human_volunteer` | humain    | ≥ 100  | Dépôt de l'équipe, consentement écrit                                                   |
| `ai_assistant`    | IA        | ≥ 100  | Dépôt de l'équipe : ChatGPT, Gemini, Copilot, Le Chat                                   |
| `ai_edited`       | mixte     | libre  | Dépôt de l'équipe : textes générés puis retouchés (publiés sans porte)                  |

- **Textes publics** : 500 au total, créés (et, pour le forum, modifiés) au plus tard le 30/11/2022, de 150 à 1 500 mots, en français. Si le forum donne moins de 150 textes, les résumés complètent jusqu'à 500.
- **HAL** : la licence est lue dépôt par dépôt (`licence_s`). Les licences « non commerciale » (NC), « pas de modification » (ND), le droit d'auteur et l'absence de licence sont écartés.
- **Exclusions** : tout texte, adresse ou copie partielle (20 % de suites de 8 mots) du corpus de FR 0.6 (run `v6`) et des jeux `detection-v1` à `detection-v4`.

## Dépôt de l'équipe

Même format que `verification-en-v1` (voir son README), dans le dossier `incoming/verification-fr-v1/` du volume :

```bash
modal volume put altydetect-veritas-corpus lot-1.jsonl incoming/verification-fr-v1/lot-1.jsonl
```

```json
{"kind": "volunteer", "text": "…", "consent_id": "V-001", "year": 2019, "genre": "essay"}
{"kind": "assistant", "text": "…", "source": "lechat", "genre": "letter"}
{"kind": "edited", "text": "…", "source": "chatgpt", "genre": "email"}
```

- `text` : en français, de 150 à 1 500 mots.
- Assistant ou retouché : `source` parmi `chatgpt`, `gemini`, `copilot`, `lechat`, `other`.
- Volontaires : `consent_id` et `year` (au plus 2022) obligatoires ; textes de francophones non natifs bienvenus. Le consentement écrit couvre les mêmes points que pour l'anglais (texte écrit sans outil de génération avant 2022, mesure unique, effacement juste après, retrait possible avant la mesure).

Aucun texte d'utilisateur de l'application n'entre dans ce jeu (CLAUDE.md §6).

## Lancement (workflow « Entraînement Veritas », run `v6`, languages `fr`)

1. **`verify-collect`** (CPU seul, quelques centimes) : télécharge le vidage de French Language Stack Exchange et interroge HAL, puis écrit les 500 textes publics dans le volume. Peut être lancé avant le dépôt.
2. **`verify`**, une fois le dépôt fait : arrêt avant toute dépense GPU s'il y a moins de 600 textes humains ou moins de 100 textes d'assistants ; sinon notation unique par VRT-DET-FR-0.6 (un L4), portes d'ADR-0018 §3, jeu gelé `verification-fr-v1/fr.jsonl` sans les volontaires, effacement de leurs textes, marque « mesuré ».

Sorties, sans aucun texte, sur la branche `ml/sorties-verify-<run>` :

- `manifest-verification-fr-v1-public.json` (après `verify-collect`) ;
- `verification-verification-fr-v1-VRT-DET-FR-0.6.json` et `manifest-verification-fr-v1.json` (après `verify`).
