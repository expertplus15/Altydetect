# Jeu de vérification `verification-en-v1` (ADR-0016)

Mesure unique de VRT-DET-EN-0.2 sur des textes réels, avant l'ouverture de l'anglais. Le jeu ne sert jamais à l'entraînement ni au choix d'un seuil. Seuls les manifestes (empreinte, catégorie, source, licence) sont commités ici, après la mesure ; les textes restent dans le volume Modal `altydetect-veritas-corpus`, dossier `verification-en-v1/`.

Code : `ml/train/train/verification.py` (règles, testées) et `ml/train/pipeline.py` (étapes Modal).

## Contenu

| Catégorie          | Étiquette | Textes | Source                                                                  |
| ------------------ | --------- | ------ | ----------------------------------------------------------------------- |
| `human_non_native` | humain    | 150    | Questions d'English Language Learners Stack Exchange (CC BY-SA 4.0)     |
| `human_forum`      | humain    | 150    | Academia, The Workplace, Writing Stack Exchange, 50 chacun (CC BY-SA 4.0) |
| `human_abstract`   | humain    | 200    | Résumés arXiv de juin 2021, articles sous CC BY, CC BY-SA ou CC0         |
| `human_volunteer`  | humain    | ≥ 100  | Dépôt de l'équipe, consentement écrit                                   |
| `ai_assistant`     | IA        | ≥ 100  | Dépôt de l'équipe : ChatGPT, Gemini, Copilot                            |
| `ai_edited`        | mixte     | libre  | Dépôt de l'équipe : textes générés puis retouchés (publiés sans porte)  |

- **Textes publics** : créés et modifiés au plus tard le 30/11/2022, de 150 à 1 500 mots, en anglais. Code, citations, tableaux et liens retirés des messages Stack Exchange.
- **arXiv** : la licence est lue article par article dans les métadonnées. Les licences « non commerciale » (NC), « pas de modification » (ND) et la licence de distribution d'arXiv sont écartées.
- **Exclusions** : tout texte, adresse ou copie partielle (20 % de suites de 8 mots) du corpus d'EN 0.2, de `detection-v1` ou de `detection-v2`.

## Dépôt de l'équipe

Un ou plusieurs fichiers JSON Lines (une ligne par texte), déposés dans le volume, dossier `incoming/verification-en-v1/`, depuis un ordinateur où la CLI Modal est connectée au compte :

```bash
modal volume put altydetect-veritas-corpus lot-1.jsonl incoming/verification-en-v1/lot-1.jsonl
```

Une ligne par texte :

```json
{"kind": "volunteer", "text": "…", "consent_id": "V-001", "year": 2019, "genre": "essay"}
{"kind": "assistant", "text": "…", "source": "chatgpt", "genre": "letter"}
{"kind": "edited", "text": "…", "source": "gemini", "genre": "email"}
```

- `kind` : `volunteer` (texte humain), `assistant` (texte généré, non retouché) ou `edited` (texte généré puis retouché à la main).
- `text` : en anglais, de 150 à 1 500 mots.
- Volontaire : `consent_id`, la référence du consentement écrit, gardé par l'équipe hors du dépôt et du volume ; `year`, l'année d'écriture, au plus 2022.
- Assistant ou retouché : `source` parmi `chatgpt`, `gemini`, `copilot`, `other`.
- Facultatif : `genre` parmi `essay`, `letter`, `email`, `report`, `answer`, `article`, `other`.

Une ligne mal formée est refusée et comptée, jamais corrigée. Les textes d'assistants sont produits à la main dans les interfaces web, sur des consignes de même genre que les textes humains (essai, lettre, courriel, réponse à une question), sans les retoucher.

### Consentement des volontaires

Le consentement écrit couvre au moins :

1. le texte a été écrit par la personne, sans outil de génération ni de reformulation, avant 2022 ;
2. il sert à une mesure unique de Veritas, jamais à l'entraînement d'un modèle ;
3. il est effacé juste après la mesure ; seuls restent son empreinte, sa catégorie, sa longueur et la probabilité donnée par Veritas ;
4. la personne peut retirer son texte avant la mesure.

Aucun texte d'utilisateur de l'application n'entre dans ce jeu (CLAUDE.md §6).

## Lancement (workflow « Entraînement Veritas », run `v2`, languages `en`)

1. **`verify-collect`** (CPU seul) : télécharge les vidages Stack Exchange et interroge arXiv, puis écrit les 500 textes publics dans le volume. Peut être lancé avant le dépôt.
2. **`verify`**, une fois le dépôt fait :
   - réunit les textes publics et le dépôt (CPU) ; arrêt avant toute dépense GPU s'il y a moins de 600 textes humains ou moins de 100 textes d'assistants ;
   - note chaque texte une fois avec VRT-DET-EN-0.2 à son seuil propre (un GPU L4) ;
   - applique les portes d'ADR-0016 §3 ;
   - écrit le jeu gelé `verification-en-v1/en.jsonl` sans les textes des volontaires, efface du dépôt les textes des volontaires et les lignes refusées, et marque le jeu « mesuré ». Une seconde mesure est refusée.

Sorties, sans aucun texte, sur la branche `ml/sorties-verify-<run>` :

- `verification-verification-en-v1-VRT-DET-EN-0.2.json` : portes, catégories, probabilités ;
- `manifest-verification-en-v1.json` : manifeste du jeu.
