# ADR-0011 — Entraînement de Veritas 0.2 : plusieurs générateurs, calibrage moins tranché

- **Statut** : accepté (portes validées le 13/11/2026 ; résultats et décision ci-dessous)
- **Date** : 2026-11-13
- **Décideurs** : équipe AltyDetect

## Contexte

Le test de robustesse (jeu gelé `detection-v2`, run 43356145940, fiches
`docs/models/VRT-DET-{FR,EN}-0.1.md`) montre que Veritas 0.1 :

- ne produit **aucun faux positif** sur 800 textes humains jamais vus ;
- reconnaît **Claude** (99 à 100 %, même sur 150 mots), le seul générateur de son corpus ;
- reconnaît mal les **autres modèles** : Mistral 3 à 4 %, Qwen 54 % (FR) et 5 % (EN), Phi 83 %
  (FR) et 19 % (EN) ;
- classe 78 à 80 % des **textes mixtes** « Probablement humain » ;
- n'utilise presque jamais la zone « Indéterminé » (0 à 6 %) : probabilités trop tranchées.

Veritas 0.1 ne peut donc pas répondre seul (ADR-0010 le garde en mode fantôme). Options :
(a) plus de textes de Claude : ne corrige pas la dépendance au générateur ; (b) des textes
d'autres modèles commerciaux par API : coûteux, conditions d'utilisation souvent contraires à
l'entraînement d'un détecteur ; (c) des **modèles ouverts** à licence permissive, sur des GPU
Modal à la demande : retenu.

## Décision

**Corpus 0.2** (run `v2`, `ml/train/train/corpus_v2.py`), par langue :

| Partie                                                    | Textes | Coût API Claude |
| --------------------------------------------------------- | ------ | --------------- |
| Textes humains C4 / mC4 de v1 (train + calibration)       | 4 400  | 0 (recopiés)    |
| Textes de Claude de v1, appariés                          | 4 400  | 0 (recopiés)    |
| Textes de modèles ouverts, sur les sujets des humains     | 2 400  | 0               |
| Textes de Claude reformulés par un modèle ouvert          | 600    | 0               |
| Textes mixtes (début humain, fin Claude), sans génération | 1 000  | 0               |

- Modèles ouverts, sans accès restreint, licence Apache-2.0, sur GPU L4 : Qwen2.5-7B-Instruct,
  Mistral-7B-Instruct-v0.3, Granite-3.3-8B-Instruct ; OLMo-2-7B-Instruct en anglais
  seulement. Chaque source reçoit un générateur réparti uniformément et stable.
- **Phi-3.5-mini n'est jamais utilisé** : générateur tenu à l'écart, il mesure la
  généralisation à un modèle inconnu dans `detection-v2`.
- Sources : partitions train et calibration de v1 seulement. Aucun texte de `detection-v2`
  ni aucune de ses sources (partition test de `detection-v1`) n'entre dans le corpus.
  `detection-v1` reste le jeu de test du document entier, inchangé.
- Textes mixtes : pas de passage « document entier » ; des fenêtres de phrases prises d'un
  seul côté de la frontière, étiquetées humain ou généré. Le modèle apprend la phrase, ce qui
  sert le surlignage par phrase.

**Entraînement** : même architecture (ADR-0008). Couche 2 avec lissage des étiquettes (0,1)
et classes équilibrées ; couche 3 plus régularisée (C = 1) et équilibrée. Objectif : des
probabilités moins extrêmes et une zone « Indéterminé » réellement utilisée. Les seuils de
production (0,70 / 0,30) ne changent pas.

**Calcul** : génération par lots de 100 consignes, 8 GPU L4 au plus en parallèle, chaque lot
sauvegardé dans le volume (reprise sans régénérer) ; paquets coupés en deux si la mémoire
GPU manque. Les deux langues s'entraînent en parallèle (deux L4) : même coût que l'une après
l'autre, deux fois moins long. Cela remplace, pour v2, la règle « un seul GPU à la fois »
d'ADR-0009 ; jamais de GPU permanent.

**Lancement en deux temps** (`ml/train/requests/run.json`) : `stage: corpus, run: v2`, puis,
une fois le corpus vérifié, `stage: train, run: v2`. Chaque étape tient sous la coupure de
330 min.

**Portes de sortie** (`GATES` dans `corpus_v2.py`), par langue, seuils de production —
**validées le 13/11/2026** :

| Porte                                                      | Seuil  |
| ---------------------------------------------------------- | ------ |
| Faux positifs, tous textes humains (detection-v1 et v2)    | ≤ 1 %  |
| Rappel sur Claude (detection-v1)                           | ≥ 95 % |
| Rappel sur les générateurs vus (Qwen, Mistral, reformulés) | ≥ 80 % |
| Rappel sur le générateur inconnu (Phi-3.5-mini)            | ≥ 60 % |

Le rapport du run indique chaque porte, mesurée et franchie ou non. Un modèle qui franchit
toutes les portes peut remplacer 0.1 en mode fantôme ; servir seul reste soumis à la porte
d'accord de la phase 3 (ADR-0010).

## Corpus 0.2 obtenu (run 43366022743, 13/11/2026)

Manifestes sans texte : `ml/corpus/manifests/veritas-0.2/{fr,en}.jsonl` (partitions train et
calibration ; la partition test reste `detection-v1`). Le corpus v1 y est inclus à l'identique.

| Partie                                      | FR     | EN     |
| ------------------------------------------- | ------ | ------ |
| Textes humains (v1)                         | 4 400  | 4 400  |
| Textes de Claude (v1)                       | 4 397  | 4 400  |
| Textes de modèles ouverts (sur 2 400 visés) | 2 302  | 2 362  |
| Reformulations (sur 600 visées)             | 598    | 599    |
| Textes mixtes                               | 1 000  | 1 000  |
| **Total**                                   | 12 697 | 12 761 |

Par générateur (textes ouverts et reformulations) : FR Qwen 867, Mistral 1 029, Granite
1 004 ; EN Qwen 697, Mistral 756, Granite 754, OLMo 754. Les textes écartés sont presque tous
de Qwen (FR 99 sur 966 consignes, EN 39 sur 736) : réponses de moins de 150 mots une fois les
titres retirés, rejetées par `clean_generation`. Qwen reste le générateur le moins représenté.

Vérifications : aucune empreinte commune avec la partition test de `detection-v1` ni avec
`detection-v2` ; aucun texte dérivé d'une source de test ; aucun doublon.

Calcul : 64 lots, 3 h 11 de bout en bout, ≈ 20 h de GPU L4 d'après le journal, soit
≈ 16 $ (au-dessus de l'estimation de 12 à 14 $, sous le plafond de 25 $). Écart : Granite et
OLMo, plus lents que prévu, ont souvent manqué de mémoire GPU sur les longues réponses
(paquets coupés en deux, aucun lot perdu).

## Résultats de l'entraînement (run 43425145321, 13/11/2026)

Fiches : `docs/models/VRT-DET-EN-0.2.md`, `docs/models/VRT-DET-FR-0.2.md` ; rapports dans
`docs/models/reports/`. 1 h 32 de bout en bout, au plus ≈ 2,4 h de GPU L4 (≈ 2 $).

| Porte                                    | FR 0.2    | EN 0.2  |
| ---------------------------------------- | --------- | ------- |
| Faux positifs ≤ 1 %                      | **3,7 %** | 0,14 %  |
| Rappel sur Claude ≥ 95 %                 | 100 %     | 100 %   |
| Rappel sur les générateurs vus ≥ 80 %    | 99,7 %    | 100 %   |
| Rappel sur Phi-3.5-mini (inconnu) ≥ 60 % | 100 %     | 100 %   |
| **Toutes franchies**                     | **non**   | **oui** |

**Décision** :

- **Anglais** : VRT-DET-EN-0.2 remplace VRT-DET-EN-0.1 en mode fantôme : paquet livré dans
  `services/veritas/models/en` ; couche 2 servie par la même application Modal, qui lit les
  poids par référence (aucun redéploiement). Servir seul reste soumis à la porte d'accord de la
  phase 3 (ADR-0010).
- **Français** : VRT-DET-FR-0.1 reste en mode fantôme. VRT-DET-FR-0.2 reconnaît tous les
  générateurs mesurés mais classe « Probablement IA » 8 % des extraits Wikipédia et 2,5 % des
  pages mC4 du jeu de test. Pas de relèvement du seuil choisi sur le jeu de test. Une version
  0.3 avec des textes humains plus variés (registre soutenu) fera l'objet d'un nouvel ADR.
- Les scores de 100 % restent à confirmer hors laboratoire (jeux produits comme le corpus).
- La zone « Indéterminé » reste presque vide : objectif de calibrage non atteint, à reprendre
  en 0.3.
- 31 min se sont écoulées entre le lancement et la fin de la préparation des passages, pour les
  deux langues à la fois. La cause n'est pas établie (préparation sur le GPU, démarrage du
  conteneur ou attente d'un GPU, cette dernière n'étant pas facturée) : à mesurer en 0.3
  (ADR-0012). Correction du 14/11/2026 : une version précédente l'attribuait à la seule
  préparation.

## Conséquences

- **Coût estimé** (tarifs Modal du 10/11/2026, L4 à 0,80 $/h ; débits mesurés pendant le test
  de robustesse : 5 à 13 s de GPU par consigne) : génération ≈ 15 h de L4, soit ≈ 12 à 14 $ ;
  entraînement ≈ 2 × 2 h de L4, soit ≈ 3 à 4 $. **Total ≈ 15 à 18 $, plafond prudent 25 $.**
  Aucun appel à l'API Claude.
- **Durée** : ≈ 2 à 3 h pour le corpus, ≈ 2 h à 2 h 30 pour l'entraînement.
- Les textes générés restent dans le volume `altydetect-veritas-corpus` ; seuls les
  manifestes (identifiant, empreinte, générateur, licence, partition) sont commités.
- Les textes générés par des modèles ouverts portent leur licence (Apache-2.0) ; aucune
  condition d'utilisation n'interdit d'en entraîner un détecteur.
- Limite connue : aucun texte des assistants commerciaux autres que Claude (ChatGPT, Gemini).
  `openai/gpt-oss-20b` (Apache-2.0) s'en approcherait mais demande un GPU plus gros et un
  format de réponse à part : à évaluer pour 0.3.
- Si une porte n'est pas franchie : pas de remplacement de 0.1 ; analyse par catégorie, puis
  décision (plus de données, autre encodeur, seuils) dans un nouvel ADR.
