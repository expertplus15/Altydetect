# Fiche modèle — VRT-DET-FR-0.2 (Veritas, détection IA, français)

- **Référence** : `VRT-DET-FR-0.2`
- **Date** : 2026-11-13
- **Statut** : **non retenu** (porte des faux positifs non franchie, ADR-0011).
  VRT-DET-FR-0.1 reste le modèle français en mode fantôme ; une version 0.3 avec des textes
  humains plus variés est à préparer.
- **Run** : [43425145321](https://github.com/expertplus15/Altydetect/actions/runs/43425145321)
  (run `v2`, étape `train`) ; corpus : run
  [43366022743](https://github.com/expertplus15/Altydetect/actions/runs/43366022743)
- **Paquet** : volume Modal `altydetect-veritas-models`, dossier `VRT-DET-FR-0.2` (conservé pour
  l'analyse, jamais dans le dépôt)
- **Jeux de test** : `ml/eval/testset/detection-v1/fr.jsonl`,
  `ml/eval/testset/detection-v2/fr.jsonl` (robustesse), gelés
- **Rapports** : `docs/models/reports/detection-v1-VRT-DET-FR-0.2.json`,
  `docs/models/reports/robustness-detection-v2-VRT-DET-FR-0.2.json`
- **Voir aussi** : `VRT-DET-FR-0.1.md`, `VRT-DET-EN-0.2.md`, ADR-0011

## Méthode (ADR-0008, réglages d'ADR-0011)

1. Couche 1 : 9 traits stylométriques, régression logistique (CPU).
2. Couche 2 : `almanach/camembert-base` affiné 2 époques (3764 pas, perte finale 0,232),
   lissage des étiquettes 0,1, classes équilibrées, GPU L4.
3. Couche 3 : combinaison logistique des deux logits (C = 1, classes équilibrées), ajustée sur
   la partition de calibration.
4. Bandes : seuils de `services/veritas/config/thresholds.yaml` (IA ≥ 0,70, humain ≤ 0,30),
   inchangés.

## Corpus 0.2

| Partition    | Documents                           | Passages |
| ------------ | ----------------------------------- | -------- |
| Entraînement | 11 448                              | 30 109   |
| Calibration  | 1 249                               | 3 273    |
| Test (gelé)  | 2000 (1 000 humains, 1 000 générés) | —        |

Corpus v1 (C4 / mC4 et Claude Sonnet 5.5) inclus à l'identique, plus 2 302 textes de modèles
ouverts (Qwen2.5-7B, Mistral-7B v0.3, Granite-3.3-8B), 598 textes de Claude reformulés par ces
modèles et 1 000 textes mixtes. Phi-3.5-mini n'est jamais utilisé. Manifestes sans texte :
`ml/corpus/manifests/veritas-0.2/fr.jsonl`.

## Résultats sur detection-v1

| Mesure                                             | 0.2                          | 0.1     |
| -------------------------------------------------- | ---------------------------- | ------- |
| Précision (« Probablement IA »)                    | 97,6 %                       | 99,6 %  |
| Rappel                                             | 100,0 %                      | 100,0 % |
| Faux positifs sur textes humains                   | **2,5 % (25 sur 1 000)**     | 0,4 %   |
| Borne haute à 95 % des faux positifs               | 3,7 %                        | 1,0 %   |
| « Indéterminé »                                    | humains 2,0 %, générés 0,0 % | 0,2 %   |
| AUROC                                              | 0,9992                       | 1,0     |
| Latence par document (GPU L4 chaud, couches 1 à 3) | 68 ms                        | 66 ms   |

## Robustesse sur detection-v2

Mêmes seuils que la production. Part des textes par bande, et part « Probablement IA » de 0.1
pour comparaison.

| Catégorie                         | Textes | « Probablement IA » | « Indéterminé » | « Probablement humain » | 0.1   |
| --------------------------------- | ------ | ------------------- | --------------- | ----------------------- | ----- |
| Humains : Wikipédia (mars 2022)   | 300    | **8 %**             | 3 %             | 89 %                    | 0 %   |
| Humains : courts (150-200 mots)   | 100    | **3 %**             | 1 %             | 96 %                    | 0 %   |
| Claude : courts (150-200 mots)    | 100    | **100 %**           | 0 %             | 0 %                     | 100 % |
| Claude reformulé par Mistral      | 100    | **99 %**            | 0 %             | 1 %                     | 71 %  |
| Qwen2.5-7B-Instruct               | 90     | **100 %**           | 0 %             | 0 %                     | 54 %  |
| Mistral-7B-Instruct-v0.3          | 100    | **100 %**           | 0 %             | 0 %                     | 3 %   |
| Phi-3.5-mini-instruct (jamais vu) | 100    | **100 %**           | 0 %             | 0 %                     | 83 %  |
| Mixtes (début humain, fin Claude) | 100    | 61 %                | 18 %            | 21 %                    | 16 %  |

## Portes de sortie (ADR-0011)

| Porte                                                   | Seuil  | Mesuré    | Franchie |
| ------------------------------------------------------- | ------ | --------- | -------- |
| Faux positifs, tous textes humains (detection-v1 et v2) | ≤ 1 %  | **3,7 %** | **non**  |
| Rappel sur Claude (detection-v1)                        | ≥ 95 % | 100 %     | oui      |
| Rappel sur les générateurs vus                          | ≥ 80 % | 99,7 %    | oui      |
| Rappel sur le générateur inconnu (Phi-3.5-mini)         | ≥ 60 % | 100 %     | oui      |

## Analyse

- Le modèle reconnaît désormais tous les générateurs mesurés, y compris Phi, jamais vu.
- En échange, il prend une partie des textes humains au style soutenu pour des textes générés :
  8 % des extraits Wikipédia, 2,5 % des pages mC4 du jeu de test, 3 % des textes courts. VRT-DET-FR-0.1
  n'en classait aucun « Probablement IA » sur detection-v2. Hypothèse : les textes humains du
  corpus (pages web C4 / mC4) sont moins variés que les textes générés ; le registre
  encyclopédique ou soutenu est associé à la classe « générée ».
- Les probabilités des textes générés plafonnent vers 0,97 (lissage des étiquettes) et
  celles des faux positifs vont jusqu'à 0,90. Relever le seuil « Probablement IA » du français
  à 0,90 ramènerait les faux positifs de detection-v2 à 0,5 % pour 79 % de rappel, mais ce
  seuil serait choisi sur le jeu de test : non retenu sans nouveau calibrage sur la partition
  de calibration et vérification sur des textes neufs.

## Suite : VRT-DET-FR-0.3

Ajouter au corpus des textes humains plus variés, en particulier de registre soutenu
(encyclopédique, dissertations, courriers, documents professionnels), sous licence permissive
et sans recouvrement avec `detection-v2` ; garder les mêmes portes. Décision et budget dans un
nouvel ADR.
