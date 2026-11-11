# Fiche modèle — VRT-DET-FR-0.1 (Veritas, détection IA, français)

- **Référence** : `VRT-DET-FR-0.1`
- **Date** : 2026-11-11
- **Run** : [42928107614](https://github.com/expertplus15/Altydetect/actions/runs/42928107614) (ADR-0009)
- **Paquet** : `services/veritas/models/fr/manifest.json` (poids de l'encodeur dans le
  volume Modal `altydetect-veritas-models`, jamais dans le dépôt)
- **Jeu de test** : `ml/eval/testset/detection-v1/fr.jsonl` (gelé)
- **Rapport** : `docs/models/reports/detection-v1-VRT-DET-FR-0.1.json`
- **Voir aussi** : `VRT-DET-EN-0.1.md`

## Méthode (ADR-0008)

1. Couche 1 : 9 traits stylométriques, régression logistique (CPU).
2. Couche 2 : `almanach/camembert-base` affiné 2 époques (2544 pas, perte finale 0.0078), GPU L4.
3. Couche 3 : combinaison logistique des deux logits, ajustée sur la partition de
   calibration ; Platt neutre.
4. Bandes : seuils de `services/veritas/config/thresholds.yaml` (IA ≥ 0,70, humain ≤ 0,30).

## Corpus

| Partition    | Documents                           |
| ------------ | ----------------------------------- |
| Entraînement | 7927                                |
| Calibration  | 870                                 |
| Test (gelé)  | 2000 (1 000 humains, 1 000 générés) |

Textes humains : C4 / mC4 (ODC-BY 1.0), exploration d'avril 2019 ; fragment 0 pour
l'entraînement et la calibration, fragment 1 pour le test. Textes générés : un par texte
humain, même sujet, genre et longueur, par Claude Sonnet 5.5 (API Message Batches).
Manifestes sans texte : `ml/corpus/manifests/veritas-0.1/`.

## Résultats sur detection-v1

| Mesure                                             | Valeur                       |
| -------------------------------------------------- | ---------------------------- |
| Précision (« Probablement IA »)                    | 99,6 %                       |
| Rappel                                             | 100,0 %                      |
| Faux positifs sur textes humains                   | **0,4 % (4 sur 1 000)**      |
| Borne haute à 95 % des faux positifs               | 1,0 %                        |
| « Indéterminé »                                    | humains 0,2 %, générés 0,0 % |
| AUROC                                              | 0,999997                     |
| Latence par document (GPU L4 chaud, couches 1 à 3) | 66 ms                        |

**Porte faux positifs** (< 1 %) : franchie sur ce jeu (0,4 %). La borne haute à 95 %
(1,0 %) touche le seuil : à confirmer sur des textes humains réels en mode fantôme.

## Limites à connaître

- **Plafond, pas promesse** : jeu de test de la même distribution que l'entraînement (pages
  C4 / mC4 de 2019, 180 à 900 mots) et un seul générateur. Les textes d'autres modèles, les
  textes retouchés à la main, mixtes ou très courts ne sont pas mesurés ici.
- **Écart avec le fournisseur externe : non mesuré.** Aucun contrat n'est encore signé
  (ADR-0001). Le mode fantôme le mesurera en production ; la porte de la phase 3 est un
  accord ≥ 85 % sur un échantillon suffisant (`min_comparisons`, encore TODO).
- **Non activé** : la couche 2 (`altydetect-veritas-encoder`) n'est pas déployée sur Modal et
  `VERITAS_MODEL_DIR` n'est défini nulle part. Tant que ce n'est pas fait, l'externe répond
  seul.
