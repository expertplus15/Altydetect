# Fiche modèle — VRT-DET-FR-0.6 (Veritas, détection IA, français)

- **Référence** : `VRT-DET-FR-0.6`
- **Date** : 2026-11-18 (entraînement) ; 2026-11-20 (seuil propre et mesure sur `detection-v4`)
- **Statut** : **livré** dans `services/veritas/models/fr`, à la place de FR 0.1, avec un seuil propre de **0,93** (ADR-0017). Les quatre portes sont franchies à ce seuil sur le jeu neuf `detection-v4` (0,45 % de faux positifs). Le critère d'ADR-0015 §2 est rempli. Le français reste fermé aux utilisateurs jusqu'à la vérification sur des textes réels (ADR-0018).
- **Run** : [44352541251](https://github.com/expertplus15/Altydetect/actions/runs/44352541251) (run `v6`, étape `all`) : recopie du corpus, entraînement, mesure et seuils dans le même run, en 2 h 34.
- **Seuil et mesure** : run [44643189844](https://github.com/expertplus15/Altydetect/actions/runs/44643189844) (étape `measure-v4`), sur le jeu construit par le run [44625772183](https://github.com/expertplus15/Altydetect/actions/runs/44625772183) (étape `testset-v4`).
- **Paquet** : `services/veritas/models/fr/manifest.json` (couches 1 et 3) ; poids de la couche 2 dans le volume Modal `altydetect-veritas-models`, dossier `VRT-DET-FR-0.6`, servis par `altydetect-veritas-encoder` (aucun redéploiement).
- **Jeux de test** : `detection-v1`, `detection-v2` (robustesse) et `detection-v3` (registre soutenu) ; `detection-v4` (jeu neuf, mesure unique au seuil propre, ADR-0017).
- **Rapports** (dans `docs/models/reports/`) :
  - `detection-v1-VRT-DET-FR-0.6.json` ;
  - `robustness-detection-v2-VRT-DET-FR-0.6.json` ;
  - `robustness-detection-v3-VRT-DET-FR-0.6.json` ;
  - `threshold-VRT-DET-FR-0.6.json` : choix du seuil sur la calibration (grille 0,70 à 0,90) ;
  - `threshold-VRT-DET-FR-0.6-detection-v4.json` : choix du seuil sur la grille élargie (0,70 à 0,95) ;
  - `robustness-detection-v4-VRT-DET-FR-0.6-seuil.json` : mesure unique sur `detection-v4` au seuil de 0,93.
- **Voir aussi** : ADR-0015 (décision et résultats), ADR-0017 (grille élargie et `detection-v4`), ADR-0013 (règle du seuil), `VRT-DET-FR-0.5.md`

## Méthode (ADR-0015)

Seule la couche 2 change par rapport à FR 0.5.

1. **Couche 1** : 9 traits stylométriques, régression logistique.
2. **Couche 2** : `almanach/camembert-large` (≈ 335 M de paramètres, licence MIT) au lieu de `camembert-base`.
   - 8 210 pas sur un GPU L4, en 1 h 32.
   - Taux d'apprentissage 1e-5 ; lot effectif de 16 (deux lots de 8, gradient accumulé).
   - Perte finale : 0,216 (FR 0.5 : 0,218).
   - Lissage des étiquettes 0,1, classes équilibrées, 2 époques.
3. **Couche 3** : combinaison logistique, ajustée sur la partition de calibration.
4. **Bandes** : seuils généraux de `services/veritas/config/thresholds.yaml` (IA ≥ 0,70, humain ≤ 0,30).

## Corpus

Le corpus 0.5 recopié à l'identique (`ml/corpus/manifests/veritas-0.5/fr.jsonl`, voir `VRT-DET-FR-0.5.md`). Aucune nouvelle source, aucune génération, aucun appel à l'API Claude.

| Partition    | Documents | Passages |
| ------------ | --------- | -------- |
| Entraînement | 25 030    | 65 678   |
| Calibration  | 2 786     | 7 268    |
| Test (gelé)  | 2 000     | —        |

## Résultats sur les jeux de test (seuil général 0,70)

| Textes humains classés « Probablement IA » | FR 0.4    | FR 0.5     | FR 0.6                    |
| ------------------------------------------ | --------- | ---------- | ------------------------- |
| detection-v1 (pages mC4)                   | 1,3 %     | 1,1 %      | 0,7 % (7 sur 1 000)       |
| Wikipédia (detection-v2)                   | 2,3 %     | 1,33 %     | 1,33 % (4 sur 300)        |
| Textes courts (detection-v2)               | 3 %       | 3 %        | 4 % (4 sur 100)           |
| Pages universitaires (detection-v3)        | 5,5 %     | 2,5 %      | 0,5 % (1 sur 200)         |
| Arrêts (detection-v3)                      | 0 %       | 0 %        | 0 % (0 sur 200)           |
| **Tous (porte ≤ 1 %)**                     | **1,9 %** | **1,28 %** | **0,89 % (16 sur 1 800)** |

Autres mesures sur detection-v1 :

- précision : 99,3 % ;
- rappel : 100 % ;
- AUROC : 0,9999 ;
- « Indéterminé » : 0,4 % des humains, 0 % des générés ;
- latence : 179 ms par document (L4 chaud, couches 1 à 3), contre 64 ms pour FR 0.5.

| Textes générés classés « Probablement IA »   | FR 0.5 | FR 0.6 |
| -------------------------------------------- | ------ | ------ |
| Claude, courts (detection-v2)                | 100 %  | 100 %  |
| Claude reformulé par Mistral                 | 99 %   | 99 %   |
| Qwen2.5-7B, Mistral-7B                       | 100 %  | 100 %  |
| Phi-3.5-mini (jamais vu)                     | 100 %  | 100 %  |
| Pages universitaires générées (detection-v3) | 100 %  | 100 %  |
| Arrêts générés (detection-v3)                | 98,8 % | 98,8 % |
| Mixtes (début humain, fin Claude)            | 68 %   | 97 %   |

## Portes de sortie (ADR-0011, ADR-0012), au seuil général

| Porte                                           | Seuil  | Mesuré | Franchie |
| ----------------------------------------------- | ------ | ------ | -------- |
| Faux positifs, tous textes humains (v1, v2, v3) | ≤ 1 %  | 0,89 % | oui      |
| Rappel sur Claude                               | ≥ 95 % | 100 %  | oui      |
| Rappel sur les générateurs vus                  | ≥ 80 % | 99,5 % | oui      |
| Rappel sur le générateur inconnu (Phi-3.5-mini) | ≥ 60 % | 100 %  | oui      |

## Seuil propre (règle d'ADR-0013, inchangée)

La règle demande au plus 0,5 % de faux positifs sur la partition de calibration (1 236 textes humains, 1 456 générés), sur la grille 0,70 à 0,90. **Aucun seuil ne convient.** Il n'y a donc pas de seuil propre ni de rapports `-seuil`.

| Seuil | Faux positifs FR 0.5 | Faux positifs FR 0.6 | Rappel FR 0.6 |
| ----- | -------------------- | -------------------- | ------------- |
| 0,70  | 44 (3,6 %)           | 14 (1,13 %)          | 99,9 %        |
| 0,78  | —                    | 13 (1,05 %)          | 99,9 %        |
| 0,83  | —                    | 11 (0,89 %)          | 99,9 %        |
| 0,85  | —                    | 10 (0,81 %)          | 99,7 %        |
| 0,86  | —                    | 9 (0,73 %)           | 99,7 %        |
| 0,90  | 8 (0,65 %)           | 8 (0,65 %)           | 99,7 %        |

Faux positifs de calibration par catégorie (FR 0.6) :

| Catégorie                      | Textes | à 0,70 | à 0,90 |
| ------------------------------ | ------ | ------ | ------ |
| Pages universitaires (0.3–0.5) | 465    | 8      | 4      |
| Pages mC4 (0.1)                | 435    | 4      | 3      |
| Pages web mC4 (0.5)            | 79     | 1      | 0      |
| Corpus déposé (0.5)            | 66     | 0      | 0      |
| Arrêts                         | 191    | 1      | 1      |

## Analyse

- **L'encodeur plus grand réduit fortement les erreurs**, sans nouveau corpus :
  - faux positifs de calibration à 0,70 : 44 → 14 ;
  - pages universitaires de test : 2,5 % → 0,5 % ;
  - textes mixtes reconnus : 68 % → 97 %.
- **Les erreurs restantes sont des textes humains notés très haut.** Les 14 faux positifs de calibration ont une probabilité entre 0,78 et 0,95 ; 8 dépassent 0,90. Relever le seuil n'y change presque rien : la règle d'ADR-0013 ne peut pas être remplie sur cette grille.
- **Les pages universitaires restent la première source d'erreurs** (8 des 14), puis les pages mC4 (4).
- **Les textes courts** passent de 3 à 4 sur 100. Aucune source du corpus ne les vise.
- **Latence** : environ trois fois celle de FR 0.5 sur un GPU chaud, comme prévu pour un encodeur large.

## Seuil propre sur la grille élargie et mesure sur `detection-v4` (ADR-0017)

**Choix du seuil** (calibration seulement, 1 236 textes humains et 1 456 générés, grille 0,70 à 0,95, règle d'ADR-0013 inchangée) : **0,93**.

| Seuil    | Faux positifs  | Rappel     |
| -------- | -------------- | ---------- |
| 0,90     | 8 (0,65 %)     | 99,7 %     |
| 0,92     | 8 (0,65 %)     | 99,7 %     |
| **0,93** | **5 (0,40 %)** | **98,9 %** |
| 0,94     | 3 (0,24 %)     | 96,8 %     |
| 0,95     | 2 (0,16 %)     | 88,5 %     |

**Mesure unique sur `detection-v4`** (1 100 textes humains, 800 générés ou mixtes, jamais vus), au seuil de 0,93 :

| Catégorie                     | Textes | « Probablement IA » | « Indéterminé » | « Probablement humain » |
| ----------------------------- | ------ | ------------------- | --------------- | ----------------------- |
| Pages web (mC4)               | 400    | 0,75 % (3)          | 0,75 %          | 98,5 %                  |
| Wikipédia                     | 300    | 0,33 % (1)          | 0,33 %          | 99,3 %                  |
| Pages universitaires          | 200    | 0 %                 | 0,5 %           | 99,5 %                  |
| Arrêts                        | 100    | 0 %                 | 0 %             | 100 %                   |
| Textes courts (150-200 mots)  | 100    | 1 % (1)             | 1 %             | 98 %                    |
| Claude                        | 200    | 99,5 %              | 0,5 %           | 0 %                     |
| Qwen, Mistral, Granite        | 300    | 100 %               | 0 %             | 0 %                     |
| Phi-3.5-mini (jamais vu)      | 100    | 100 %               | 0 %             | 0 %                     |
| Claude reformulé par Mistral  | 100    | 95 %                | 5 %             | 0 %                     |
| Mixtes (début humain, fin IA) | 100    | 65 %                | 30 %            | 5 %                     |

| Porte (ADR-0015 §2)                 | Seuil  | Mesuré               | Franchie |
| ----------------------------------- | ------ | -------------------- | -------- |
| Faux positifs, tous textes humains  | ≤ 1 %  | 0,45 % (5 sur 1 100) | oui      |
| Rappel sur Claude                   | ≥ 95 % | 99,5 %               | oui      |
| Rappel sur les générateurs vus      | ≥ 80 % | 98,75 %              | oui      |
| Rappel sur Phi-3.5-mini (jamais vu) | ≥ 60 % | 100 %                | oui      |

- Les 5 faux positifs ont une probabilité entre 0,933 et 0,950 : 3 pages web, 1 article de Wikipédia, 1 texte court.
- Les pages universitaires, première source d'erreurs à 0,70, n'en donnent plus aucune.
- Le prix du seuil haut se voit sur les textes mixtes (30 % en « Indéterminé ») et reformulés (5 %) : c'est la bande « Indéterminé » qui s'élargit, comme prévu par ADR-0017.

## Suite

- Paquet livré dans `services/veritas/models/fr`, seuil inscrit dans `thresholds.yaml`.
- Le français reste fermé aux utilisateurs jusqu'à la vérification sur des textes réels (ADR-0018), sur le modèle d'ADR-0016.

## Suite prévue avant ADR-0017 (historique)

Selon ADR-0015 §4 : le français reste indisponible, sans nouvel essai de seuil sur les mêmes jeux de test. Un nouvel ADR choisira la suite, avec une estimation de coût avant tout lancement :

- d'autres sources universitaires sous licence ouverte (HAL CC BY, étape 2 de la feuille de route) ;
- un encodeur multilingue plus grand ;
- une bande « Indéterminé » plus large pour le français.
