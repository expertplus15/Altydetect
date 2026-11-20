# ADR-0017 — Suite du français : seuil propre de FR 0.6 sur une grille élargie, mesuré sur un jeu neuf

- **Statut** : accepté (19/11/2026) et exécuté (20/11/2026) : piste A réussie, voir « Résultats ». Mise en œuvre : `ml/eval/testset/detection-v4/README.md`.
- **Date** : 2026-11-19
- **Décideurs** : équipe AltyDetect
- **Suite de** : ADR-0015 §4 (FR 0.6 ne remplit pas le critère d'ouverture), ADR-0013 (règle du seuil propre)

## Contexte

**Où en est FR 0.6** (run 44352541251, fiche `docs/models/VRT-DET-FR-0.6.md`) :

- au seuil général de 0,70, les quatre portes sont franchies : 0,89 % de faux positifs, rappel 100 % sur Claude, 99,5 % sur les générateurs vus, 100 % sur Phi ;
- mais aucun seuil propre : sur la grille 0,70 à 0,90, le meilleur donne 8 faux positifs sur 1 236 textes humains de calibration (0,65 %), pour une cible de 0,5 %. Le critère d'ADR-0015 §2 n'est pas rempli et le français reste fermé.

ADR-0015 §4 prévoit trois pistes : d'autres sources universitaires, un encodeur multilingue plus grand, une bande « Indéterminé » plus large. Il interdit aussi tout nouvel essai de seuil sur `detection-v1`, `detection-v2` et `detection-v3`.

**Ce que montre la calibration de FR 0.6.** Les probabilités de FR 0.6 plafonnent vers 0,96 : c'est l'effet du lissage des étiquettes (0,1). Presque tous les textes générés sont notés entre 0,93 et 0,96. La grille d'ADR-0013 s'arrête à 0,90, en dessous de cette zone.

| Seuil (calibration) | Faux positifs (1 236 humains) | Rappel (1 550 générés et mixtes) |
| ------------------- | ----------------------------- | -------------------------------- |
| 0,90                | 8 (0,65 %)                    | 98,7 %                           |
| 0,92                | 8 (0,65 %)                    | 98,2 %                           |
| **0,93**            | **5 (0,40 %)**                | **97,2 %**                       |
| 0,94                | 3 (0,24 %)                    | 94,5 %                           |
| 0,95                | 2 (0,16 %)                    | 85,0 %                           |
| 0,96                | 0                             | 32,7 %                           |

Avec une grille qui irait jusqu'à 0,95, la règle d'ADR-0013, inchangée par ailleurs, choisirait **0,93**. À ce seuil, 1,1 % des textes humains et 2,4 % des textes générés de calibration iraient en « Indéterminé ».

**Les pistes comparées**

| Piste                                                 | Ce qu'elle vise                                      | Coût estimé         | Délai               |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------------- | ------------------- |
| A. Grille élargie, FR 0.6 mesuré sur un jeu neuf      | Seuil plus haut, bande « Indéterminé » plus large    | ≈ 3 à 4 $           | quelques jours      |
| B. Sources universitaires (HAL CC BY), nouveau modèle | Les pages universitaires, 8 des 14 erreurs à 0,70    | ≈ 8 à 12 $          | une à deux semaines |
| C. Encodeur multilingue plus grand                    | Rien de précis : camembert-large est déjà spécialisé | ≈ 3 à 5 $ par essai | quelques jours      |

- **A** réutilise le modèle existant. Elle répond à la troisième piste d'ADR-0015.
- **B** demande la collecte de l'étape 2 de la feuille de route, une génération de textes appariés et un nouvel entraînement. De FR 0.3 à FR 0.5, chaque ajout de textes humains a eu un effet plus faible que le précédent.
- **C** est écartée : les encodeurs multilingues de taille comparable (XLM-RoBERTa large) ne sont pas réputés meilleurs que camembert-large en français, et les plus grands ne s'entraînent pas sur un L4.

## Décision

**Piste A. Si elle échoue, piste B, par un nouvel ADR.**

### 1. Grille du seuil propre élargie à 0,95

- La borne haute de la grille d'ADR-0013 passe de 0,90 à 0,95 (`MODEL_LIKELY_AI_RANGE` dans `services/veritas/src/veritas/settings.py`, lu aussi par `ml/train/train/threshold.py`). Le reste de la règle ne change pas : plus petit seuil de la grille, au plus 0,5 % de faux positifs sur la calibration, pas de 0,01.
- Le seuil d'EN 0.2 (0,70) ne change pas : c'est déjà le plus petit de la grille.
- Le choix pour FR 0.6 est refait par le stage `threshold` existant, sur la calibration seulement. Il doit donner 0,93 ; toute autre valeur est rapportée telle quelle et appliquée.

**Limite reconnue** : la borne est relevée après avoir vu la calibration de FR 0.6. C'est pourquoi la mesure se fait sur un jeu jamais vu (§2), et une seule fois.

### 2. Nouveau jeu de test gelé `detection-v4` (français)

Les jeux `detection-v1` à `detection-v3` ne servent pas à mesurer ce seuil (ADR-0015 §4). Un jeu neuf, construit comme eux, permet d'appliquer les mêmes portes :

| Catégorie                    | Textes | Source                                                                  |
| ---------------------------- | ------ | ----------------------------------------------------------------------- |
| Pages web                    | 400    | mC4 français, fragment 3, jamais utilisé                                |
| Wikipédia                    | 300    | Wikipédia FR du 01/03/2022, un fragment jamais utilisé                  |
| Pages universitaires         | 200    | French Science Commons, fichiers jamais lus                             |
| Arrêts                       | 100    | même source que detection-v3, décisions jamais utilisées, s'il en reste |
| Textes courts (150-200 mots) | 100    | textes humains de ce jeu, coupés                                        |
| **Humains**                  | 1 100  |                                                                         |
| Claude                       | 200    | API Claude, modèle fixé dans la configuration, consignes habituelles    |
| Qwen, Mistral, Granite (vus) | 300    | 100 chacun, sur un L4                                                   |
| Phi-3.5-mini (jamais vu)     | 100    | sur un L4                                                               |
| Claude reformulé par Mistral | 100    |                                                                         |
| Mixtes                       | 100    | début humain, fin Claude                                                |

- Exclusions habituelles : tout texte, adresse ou copie partielle du corpus 0.5 et des jeux `detection-v1` à `v3`.
- Gelé dès sa création, avec manifeste sans texte, documenté dans `docs/models/CHANGELOG.md`.
- S'il manque des arrêts, la catégorie est réduite ou retirée, et c'est signalé dans le rapport.

### 3. Mesure unique et décision

FR 0.6 est mesuré une seule fois sur `detection-v4`, au seuil choisi au §1, avec les quatre portes d'ADR-0015 §2 : faux positifs ≤ 1 % sur tous les textes humains, rappel ≥ 95 % sur Claude, ≥ 80 % sur les générateurs vus, ≥ 60 % sur Phi.

- **Portes franchies** : FR 0.6 remplit le critère d'ADR-0015 §2. Son seuil est inscrit dans `thresholds.yaml`, et le paquet est livré dans `services/veritas/models/fr` à la place de FR 0.1. Le français s'ouvre ensuite après une vérification sur des textes réels, sur le modèle d'ADR-0016 (protocole dans un ADR d'ouverture).
- **Portes non franchies** : le français reste fermé. Aucun autre seuil n'est essayé sur `detection-v4`. Piste B, par un nouvel ADR.

### 4. Ordre de travail

Une PR par intention :

1. Code : borne de la grille, construction de `detection-v4` (nouvelle étape du workflow), tests.
2. Lancement de la construction de `detection-v4`, avec confirmation du coût.
3. Lancement du choix du seuil et de la mesure de FR 0.6, avec confirmation du coût.
4. Archivage des résultats (fiche FR 0.6, rapports, CHANGELOG, résultats dans cet ADR).

## Conséquences

**Coût** (tarifs Modal du 10/11/2026, L4 à 0,80 $/h ; débits des runs précédents)

| Étape                                                                 | Calcul               | Coût                          |
| --------------------------------------------------------------------- | -------------------- | ----------------------------- |
| Textes humains (mC4, Wikipédia, universitaires, arrêts)               | CPU                  | ≈ 0,10 à 0,20 $               |
| 360 demandes à Claude (200 et 100 pour les mixtes, + 20 % de marge)   | API Claude, par lots | ≈ 1,20 à 2,40 $               |
| 480 textes de modèles ouverts et 120 reformulations (+ 20 % de marge) | ≈ 1 h à 1 h 30 de L4 | ≈ 0,80 à 1,20 $               |
| Seuil propre (calibration) et mesure sur detection-v4                 | ≈ 20 min de L4       | ≈ 0,30 $                      |
| **Total**                                                             |                      | **≈ 3 à 4,50 $, plafond 6 $** |

**Ce qui devient plus simple** : si la piste A réussit, le français peut s'ouvrir sans nouvel entraînement, avec le modèle déjà mesuré.

**Ce qui devient plus difficile**

- Le seuil de 0,93 est proche du plafond des probabilités (≈ 0,96). Un texte généré un peu moins typique tombe vite en « Indéterminé » : c'est le prix de moins de faux positifs. Les textes reformulés et les arrêts générés, notés en moyenne 0,94, sont les plus exposés. Le rappel sur Claude (porte de 95 %) est le point à surveiller.
- Un « Indéterminé » plus fréquent en français qu'en anglais : l'interface l'affiche déjà comme un résultat à part entière (probabilité, pas verdict).

**Risques**

- **Jeu neuf trop proche des anciens** : mêmes sources et mêmes consignes. La vérification sur des textes réels reste obligatoire avant l'ouverture.
- **Plafond des probabilités** : il dépend du lissage des étiquettes. Un futur modèle (piste B) devra rechoisir son seuil ; la grille élargie s'applique alors à lui aussi.

**À revoir** : après la mesure sur `detection-v4`, puis à chaque nouveau modèle français.

## Valeurs validées (19/11/2026)

- Piste A d'abord, piste B ensuite si A échoue.
- Borne haute de la grille d'ADR-0013 : 0,95.
- Composition de `detection-v4` : 1 100 textes humains, 800 textes générés ou mixtes.
- Plafond de coût : 6 $ pour l'ensemble (construction du jeu et mesure).

## Résultats (20/11/2026)

- **Construction de `detection-v4`** (run 44625772183, 1 h 35) : 1 100 textes humains et 800 générés ou mixtes, tous les effectifs atteints, arrêts compris. Lot Claude : 360 demandes, 359 textes retenus. Exclusions : 31 pages web, 7 articles, 52 pages universitaires et 82 arrêts déjà vus. Coût estimé : 3 à 4,50 $.
- **Seuil propre** (run 44643189844) : **0,93** sur la calibration, comme prévu (5 faux positifs sur 1 236, rappel 98,9 %).
- **Mesure unique** au seuil de 0,93 : faux positifs 0,45 % (5 sur 1 100), rappel Claude 99,5 %, générateurs vus 98,75 %, Phi 100 %. **Les quatre portes sont franchies.** Coût ≈ 0,20 $.
- **Conséquences appliquées** : seuil inscrit dans `thresholds.yaml`, paquet FR 0.6 livré dans `services/veritas/models/fr` à la place de FR 0.1, jeu gelé dans `ml/eval/testset/detection-v4/`. La piste B n'est pas nécessaire.
- **Suite** : vérification sur des textes réels avant l'ouverture du français (ADR-0018).
