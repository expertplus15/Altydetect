# Fiche modèle — VRT-DET-EN-0.1 (Veritas, détection IA, anglais)

- **Référence** : `VRT-DET-EN-0.1`
- **Date** : 2026-11-11
- **Run** : [42928107614](https://github.com/expertplus15/Altydetect/actions/runs/42928107614) (ADR-0009)
- **Paquet** : `services/veritas/models/en/manifest.json` (poids de l'encodeur dans le
  volume Modal `altydetect-veritas-models`, jamais dans le dépôt)
- **Jeux de test** : `ml/eval/testset/detection-v1/en.jsonl`,
  `ml/eval/testset/detection-v2/en.jsonl` (robustesse), gelés
- **Rapports** : `docs/models/reports/detection-v1-VRT-DET-EN-0.1.json`,
  `docs/models/reports/robustness-detection-v2-VRT-DET-EN-0.1.json`
- **Voir aussi** : `VRT-DET-FR-0.1.md`

## Méthode (ADR-0008)

1. Couche 1 : 9 traits stylométriques, régression logistique (CPU).
2. Couche 2 : `microsoft/deberta-v3-base` affiné 2 époques (2478 pas, perte finale 0.0125), GPU L4.
3. Couche 3 : combinaison logistique des deux logits, ajustée sur la partition de
   calibration ; Platt neutre.
4. Bandes : seuils de `services/veritas/config/thresholds.yaml` (IA ≥ 0,70, humain ≤ 0,30).

## Corpus

| Partition    | Documents                           |
| ------------ | ----------------------------------- |
| Entraînement | 7902                                |
| Calibration  | 898                                 |
| Test (gelé)  | 2000 (1 000 humains, 1 000 générés) |

Textes humains : C4 / mC4 (ODC-BY 1.0), exploration d'avril 2019 ; fragment 0 pour
l'entraînement et la calibration, fragment 1 pour le test. Textes générés : un par texte
humain, même sujet, genre et longueur, par Claude Sonnet 5.5 (API Message Batches).
Manifestes sans texte : `ml/corpus/manifests/veritas-0.1/`.

## Résultats sur detection-v1

| Mesure                                             | Valeur                       |
| -------------------------------------------------- | ---------------------------- |
| Précision (« Probablement IA »)                    | 100,0 %                      |
| Rappel                                             | 99,9 %                       |
| Faux positifs sur textes humains                   | **0 % (0 sur 1 000)**        |
| Borne haute à 95 % des faux positifs               | 0,4 %                        |
| « Indéterminé »                                    | humains 0,0 %, générés 0,0 % |
| AUROC                                              | 1,0                          |
| Latence par document (GPU L4 chaud, couches 1 à 3) | 214 ms                       |

**Porte faux positifs** (< 1 %) : franchie sur ce jeu.

## Robustesse sur detection-v2 (2026-11-13)

Jeu gelé `ml/eval/testset/detection-v2/en.jsonl`, run
[43356145940](https://github.com/expertplus15/Altydetect/actions/runs/43356145940), rapport
`docs/models/reports/robustness-detection-v2-VRT-DET-EN-0.1.json`. Aucun de ces textes ni de
leurs sources n'a servi à l'entraînement. Mêmes seuils que la production (0,70 / 0,30).

| Catégorie                         | Textes | « Probablement IA » | « Indéterminé » | « Probablement humain » |
| --------------------------------- | ------ | ------------------- | --------------- | ----------------------- |
| Humains : Wikipédia (mars 2022)   | 300    | **0 %**             | 0 %             | 100 %                   |
| Humains : courts (150-200 mots)   | 100    | **0 %**             | 0 %             | 100 %                   |
| Claude : courts (150-200 mots)    | 100    | **99 %**            | 0 %             | 1 %                     |
| Claude reformulé par Mistral      | 100    | **100 %**           | 0 %             | 0 %                     |
| Qwen2.5-7B-Instruct               | 96     | **5 %**             | 3 %             | 92 %                    |
| Mistral-7B-Instruct-v0.3          | 100    | **4 %**             | 2 %             | 94 %                    |
| Phi-3.5-mini-instruct             | 100    | **19 %**            | 4 %             | 77 %                    |
| Mixtes (début humain, fin Claude) | 100    | 15 %                | 5 %             | 80 %                    |

Faux positifs : **0 %** sur 400 textes humains. Rappel sur
l'ensemble des textes générés : **46 %** (496 textes).

Lecture :

- **Aucun faux positif** sur 400 textes humains jamais vus (Wikipédia d'avant les assistants,
  textes courts) : la promesse de prudence tient.
- **Claude est reconnu** même sur 150 à 200 mots (99 %) et reformulé par un autre modèle
  (100 %).
- **Les autres modèles ne le sont presque pas** : Phi 19 %, Qwen 5 %, Mistral 4 %. Veritas
  0.1 a appris la signature de Claude, pas celle des textes générés en général ; l'écart est
  plus net qu'en français.
- **Textes mixtes** : 80 % « Probablement humain ». Le score du document ne signale pas une
  fin générée ; l'analyse par phrase n'est pas mesurée ici.
- **Probabilités extrêmes** : « Indéterminé » ne sert presque jamais (0 à 5 % selon la
  catégorie). Le calibrage, ajusté sur le seul couple C4 / Claude, est trop confiant hors de
  cette distribution.

**Conséquence** : Veritas 0.1 ne peut pas répondre seul aux utilisateurs. Un texte écrit par un
autre modèle que Claude serait le plus souvent annoncé « Probablement humain ». Il reste en
mode fantôme derrière le fournisseur externe (ADR-0010) jusqu'à une version entraînée sur
plusieurs générateurs et mesurée sur ce jeu.

## Limites à connaître

- **Plafond, pas promesse** : jeu de test de la même distribution que l'entraînement (pages
  C4 / mC4 de 2019, 180 à 900 mots) et un seul générateur. Hors de cette distribution, voir
  la section « Robustesse » : les textes d'autres modèles ne sont pas reconnus de façon fiable.
  Les textes retouchés à la main ne sont pas mesurés.
- **Écart avec le fournisseur externe : non mesuré.** Aucun contrat n'est encore signé
  (ADR-0001). Le mode fantôme le mesurera en production ; la porte de la phase 3 est un
  accord ≥ 85 % sur un échantillon suffisant (`min_comparisons`, encore TODO).
- **Non activé en production** : la couche 2 (`altydetect-veritas-encoder`) est déployée sur
  Modal (mise à l'échelle jusqu'à zéro), mais `VERITAS_MODEL_DIR` n'est défini sur aucun
  service. L'activation en mode fantôme suit `docs/deploiement.md`, section 7 (ADR-0010).
