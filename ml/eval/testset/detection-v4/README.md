# Jeu de test gelé `detection-v4` (français, ADR-0017)

Jeu neuf pour mesurer une seule fois VRT-DET-FR-0.6 au seuil choisi sur la grille élargie (0,70 à 0,95). `detection-v1` à `detection-v3` ne servent plus à mesurer un seuil de FR 0.6 (ADR-0015 §4). Il ne reçoit jamais de données d'entraînement. Le manifeste (sans texte) est gelé ici : `fr.jsonl` et `MANIFEST.json` (run 44625772183, empreinte vérifiée par `ml/eval/tests/test_detection_testset.py`) ; les textes restent dans le volume Modal `altydetect-veritas-corpus`, dossier `detection-v4/`.

Code : `ml/train/train/testset_v4.py` (règles, testées) et `ml/train/pipeline.py` (étapes Modal).

## Contenu

| Catégorie         | Textes | Source                                                                         |
| ----------------- | ------ | ------------------------------------------------------------------------------ |
| `human_web`       | 400    | mC4 français, fragment 3 (jamais utilisé), ODC-BY 1.0                           |
| `human_wikipedia` | 300    | Wikipédia FR du 01/03/2022, fichier 3 sur 15 (jamais utilisé), CC BY-SA 3.0     |
| `human_academic`  | 200    | French Science Commons, fichiers 7, 15, 23 et 31 (jamais lus), licences ouvertes |
| `human_legal`     | 100    | Cour de cassation (Judilibre), tranche 1 du tirage (la tranche 0 a servi), Licence ouverte 2.0 ; réduite s'il en manque |
| `human_short`     | 100    | autres pages mC4 du fragment 3, coupées à 150-200 mots                          |
| `ai_claude`       | 200    | Claude (modèle de `packages/core/src/config/llm.ts`), sur des sujets des pages web |
| `ai_qwen`, `ai_mistral`, `ai_granite` | 100 chacun | modèles ouverts vus à l'entraînement, sur un L4             |
| `ai_phi`          | 100    | Phi-3.5-mini, jamais vu                                                         |
| `ai_reformulated` | 100    | textes de Claude reformulés par Mistral                                         |
| `mixed`           | 100    | début d'une page mC4, fin du texte de Claude sur le même sujet                   |

- Exclusions : tout texte, adresse ou copie partielle (20 % de suites de 8 mots) du corpus 0.5 et de `detection-v1` à `detection-v3`.
- Les pages mC4 sont réparties sans recouvrement entre textes humains, sujets des générateurs, textes courts et débuts des mixtes.
- Génération : 20 % de consignes en plus, puis tirage stable de l'effectif exact. Le run s'arrête si une catégorie (hors arrêts) reste en dessous de son effectif.

## Lancement (workflow « Entraînement Veritas », run `v6`, languages `fr`)

1. **`testset-v4`** : textes humains (CPU), lot de 360 demandes à l'API Claude, modèles ouverts sur 8 L4 au plus (lots sauvegardés un à un, reprise possible), puis jeu gelé `detection-v4/fr.jsonl`. Rien n'est régénéré si le jeu existe. Sortie : `detection-v4-fr.jsonl` (manifeste sans texte).
2. **`measure-v4`** : seuil propre de FR 0.6 choisi sur la calibration (grille 0,70 à 0,95, ADR-0013), puis mesure unique sur `detection-v4` avec les quatre portes d'ADR-0015 §2. Une seconde mesure est refusée. Sorties : `threshold-VRT-DET-FR-0.6-detection-v4.json` et `robustness-detection-v4-VRT-DET-FR-0.6-seuil.json`.
