# Fiche modèle — VRT-DET-FR-0.5 (Veritas, détection IA, français)

- **Référence** : `VRT-DET-FR-0.5`
- **Date** : 2026-11-16
- **Statut** : **non retenu**. La porte des faux positifs n'est pas franchie (1,28 % pour 1 %), et aucun seuil propre ne convient (ADR-0013). VRT-DET-FR-0.1 reste le modèle français en mode fantôme.
- **Run** : [43901277788](https://github.com/expertplus15/Altydetect/actions/runs/43901277788) (run `v5`, étape `all`) : corpus, notation, génération, entraînement, mesure et seuil dans le même run, en 4 h 47.
- **Paquet** : volume Modal `altydetect-veritas-models`, dossier `VRT-DET-FR-0.5`. Il y est conservé pour l'analyse et n'entre jamais dans le dépôt.
- **Jeux de test** : `detection-v1`, `detection-v2` (robustesse) et `detection-v3` (registre soutenu), gelés et inchangés.
- **Rapports** (dans `docs/models/reports/`) :
  - `detection-v1-VRT-DET-FR-0.5.json` ;
  - `robustness-detection-v2-VRT-DET-FR-0.5.json` ;
  - `robustness-detection-v3-VRT-DET-FR-0.5.json` ;
  - `threshold-VRT-DET-FR-0.5.json` : choix du seuil sur la calibration.
- **Voir aussi** : ADR-0014 (décision et résultats), ADR-0013 (règle du seuil), `VRT-DET-FR-0.2.md`

## Méthode (ADR-0008, réglages d'ADR-0012, inchangés)

1. **Couche 1** : 9 traits stylométriques, régression logistique.
2. **Couche 2** : `almanach/camembert-base`, affiné en 8 210 pas sur un GPU L4.
   - Perte finale : 0,218.
   - Lissage des étiquettes : 0,1.
   - Classes équilibrées.
3. **Couche 3** : combinaison logistique, ajustée sur la partition de calibration.
4. **Bandes** : seuils généraux de `services/veritas/config/thresholds.yaml` (IA ≥ 0,70, humain ≤ 0,30).

## Corpus 0.5 (ADR-0014)

Le corpus 0.4 est repris à l'identique. Il reçoit 3 000 textes humains nouveaux, chacun avec un texte généré apparié :

- textes générés par Qwen2.5-7B, Mistral-7B v0.3 et Granite-3.3-8B ;
- Phi-3.5-mini tenu à l'écart ;
- aucun appel à l'API Claude.

| Source ajoutée                                 | Candidats notés par FR 0.4 | « Difficiles » (≥ 0,5) | Retenus (entraînement / calibration) |
| ---------------------------------------------- | -------------------------- | ---------------------- | ------------------------------------ |
| French Science Commons, 12 fichiers jamais lus | 8 847                      | 533                    | 1 500 (1 341 / 159)                  |
| mC4 français, fragment 2                       | 5 000                      | 126                    | 800 (721 / 79)                       |
| Corpus déposé (`corpus_ressources.jsonl.gz`)   | 6 000                      | 62                     | 700 (634 / 66)                       |

- **Corpus déposé** : 170 722 extraits de PDF au départ.
  - Gardés : 113 141 (français, année d'édition ≤ 2022 lue dans le nom du fichier). Ils donnent 86 863 passages, dont 6 000 tirés au sort.
  - Écartés : 26 275 sans année, 20 655 postérieurs à juin 2022, 10 651 non français, 4 qui recoupaient un jeu de test.
  - Les 700 passages retenus viennent de 199 fichiers (manuels de gestion, finance, droit et logistique surtout).
  - Licence : le déposant déclare détenir des droits écrits pour cet usage (16/11/2026). Le fichier déposé reste dans le volume, jamais dans le dépôt.
- **Exclusions** : 35 pages universitaires déjà présentes dans le corpus 0.4 ; 1 page universitaire et 130 pages web qui recoupaient un jeu de test.
- **Textes générés** : 2 825 (Qwen 838, Mistral 1 012, Granite 975).
- **Manifeste sans texte** : `ml/corpus/manifests/veritas-0.5/fr.jsonl`, 30 582 documents (empreinte, source, licence, partition).
  - Les documents des partitions entraînement et calibration ne recoupent ni `detection-v1` ni `detection-v2`, que ce soit par empreinte ou par adresse.
  - Le recoupement avec `detection-v3` a été vérifié pendant le run.

| Partition    | Documents | Passages |
| ------------ | --------- | -------- |
| Entraînement | 25 030    | 65 678   |
| Calibration  | 2 786     | 7 268    |
| Test (gelé)  | 2 000     | —        |

## Résultats sur les jeux de test (seuil général 0,70)

| Textes humains classés « Probablement IA » | FR 0.4    | FR 0.5                    |
| ------------------------------------------ | --------- | ------------------------- |
| detection-v1 (pages mC4)                   | 1,3 %     | 1,1 % (11 sur 1 000)      |
| Wikipédia (detection-v2)                   | 2,3 %     | 1,33 % (4 sur 300)        |
| Textes courts (detection-v2)               | 3 %       | 3 % (3 sur 100)           |
| Pages universitaires (detection-v3)        | 5,5 %     | 2,5 % (5 sur 200)         |
| Arrêts (detection-v3)                      | 0 %       | 0 % (0 sur 200)           |
| **Tous (porte ≤ 1 %)**                     | **1,9 %** | **1,28 % (23 sur 1 800)** |

Autres mesures sur detection-v1 :

- précision : 98,9 % ;
- rappel : 100 % ;
- AUROC : 0,9997 ;
- « Indéterminé » : 1 % des humains, 0 % des générés ;
- latence : 64 ms par document (L4 chaud, couches 1 à 3).

| Textes générés classés « Probablement IA »   | FR 0.5 |
| -------------------------------------------- | ------ |
| Claude, courts (detection-v2)                | 100 %  |
| Claude reformulé par Mistral                 | 99 %   |
| Qwen2.5-7B, Mistral-7B                       | 100 %  |
| Phi-3.5-mini (jamais vu)                     | 100 %  |
| Pages universitaires générées (detection-v3) | 100 %  |
| Arrêts générés (detection-v3)                | 98,8 % |
| Mixtes (début humain, fin Claude)            | 68 %   |

## Portes de sortie (ADR-0011, ADR-0012)

| Porte                                           | Seuil  | Mesuré     | Franchie |
| ----------------------------------------------- | ------ | ---------- | -------- |
| Faux positifs, tous textes humains (v1, v2, v3) | ≤ 1 %  | **1,28 %** | **non**  |
| Rappel sur Claude                               | ≥ 95 % | 100 %      | oui      |
| Rappel sur les générateurs vus                  | ≥ 80 % | 99,5 %     | oui      |
| Rappel sur le générateur inconnu (Phi-3.5-mini) | ≥ 60 % | 100 %      | oui      |

## Seuil propre (règle d'ADR-0013, inchangée)

La règle demande au plus 0,5 % de faux positifs sur la partition de calibration (1 236 textes humains, 1 456 générés), sur la grille 0,70 à 0,90. **Aucun seuil ne convient.** Il n'y a donc pas de seuil propre ni de rapports `-seuil`.

| Seuil | Faux positifs (calibration) | Rappel |
| ----- | --------------------------- | ------ |
| 0,70  | 44 (3,6 %)                  | 99,7 % |
| 0,80  | 33 (2,7 %)                  | 99,6 % |
| 0,88  | 15 (1,2 %)                  | 98,2 % |
| 0,89  | 12 (0,97 %)                 | 97,4 % |
| 0,90  | 8 (0,65 %)                  | 96,2 % |

Faux positifs de calibration par catégorie :

| Catégorie                      | Textes | à 0,70         | à 0,90 |
| ------------------------------ | ------ | -------------- | ------ |
| Pages universitaires (0.3–0.5) | 465    | **31 (6,7 %)** | 5      |
| Pages mC4 (0.1)                | 435    | 5              | 1      |
| Pages web mC4 (0.5)            | 79     | 4              | 1      |
| Corpus déposé (0.5)            | 66     | 3              | 0      |
| Arrêts                         | 191    | 1              | 1      |

## Analyse

- **Les ajouts ont réduit les erreurs qu'ils visaient :**
  - pages universitaires de test : 5,5 % → 2,5 % ;
  - Wikipédia : 2,3 % → 1,33 % ;
  - total : 1,9 % → 1,28 %.

  Le rappel ne baisse pas.

- **Les pages universitaires restent la principale source d'erreurs.** En calibration, elles font 31 des 44 faux positifs à 0,70 (6,7 %), bien plus que sur le jeu de test (2,5 %). Le jeu de test universitaire (200 pages) est donc sans doute favorable.
- **Le corpus déposé pose peu de difficultés à FR 0.4** : 1 % de textes « difficiles ».
- **Les textes courts ne bougent pas** (3 sur 100). Aucune source ajoutée ne les vise.
- **Écart de calibration :** les faux positifs de calibration (3,6 %) sont plus élevés que ceux du jeu de test (1,28 %). Explication probable : un texte ajouté sur dix va en calibration, et un tiers des pages universitaires ajoutées sont « difficiles ». La calibration est donc plus riche en cas limites que les jeux de test.

## Suite

Les deux pistes prévues par ADR-0014 en cas d'échec :

- un encodeur plus grand ;
- d'autres sources universitaires.

Elles feront l'objet d'un nouvel ADR, avec une estimation de coût avant tout lancement.
