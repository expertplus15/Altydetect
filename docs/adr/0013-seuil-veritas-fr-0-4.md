# ADR-0013 — Seuil « Probablement IA » propre à VRT-DET-FR-0.4

- **Statut** : accepté (règle et valeurs validées le 14/11/2026)
- **Date** : 2026-11-14
- **Décideurs** : équipe AltyDetect

## Contexte

FR 0.4 (ADR-0012, run 43617175924, 2 h 52, ≈ 4,5 $) franchit trois portes sur quatre.

- **Rappel** :
  - Claude : 100 % ;
  - générateurs vus : 99,4 % ;
  - Phi-3.5-mini, jamais vu : 100 %.
- **Faux positifs** : 1,9 % (34 textes humains sur 1 800) pour une porte de 1 %.

| Textes humains classés « Probablement IA » | FR 0.2 | FR 0.3 | FR 0.4    |
| ------------------------------------------ | ------ | ------ | --------- |
| detection-v1 (pages mC4)                   | 2,5 %  | 1,3 %  | 1,3 %     |
| Wikipédia (detection-v2)                   | 8 %    | 5,3 %  | 2,3 %     |
| Textes courts (detection-v2)               | 3 %    | 2 %    | 3 %       |
| Pages universitaires (detection-v3)        | —      | 10 %   | 5,5 %     |
| Arrêts (detection-v3)                      | —      | 0 %    | 0 %       |
| **Tous (porte ≤ 1 %)**                     | 3,7 %  | 2,8 %  | **1,9 %** |

**Les ajouts de 0.4 ont réduit les erreurs qu'ils visaient**, avec un effet de plus en plus faible :

- pages universitaires courtes : 7 erreurs sur 136, contre 15 ;
- pages universitaires de 2018 à 2022 : 8 sur 88, contre 15 ;
- pages mC4 : rien ne bouge.

**Les erreurs restantes sont proches du seuil.** Les textes humains classés « Probablement IA » ont surtout une probabilité entre 0,70 et 0,85. Les textes générés dépassent presque tous 0,90.

**Un seuil unique sert aujourd'hui tous les moteurs.** `likely_ai` vaut 0,70 dans `thresholds.yaml`, pour Veritas comme pour chaque fournisseur.

## Décision proposée

**Donner à VRT-DET-FR-0.4 son propre seuil `likely_ai`.** Il est choisi sur la partition de calibration du corpus 0.4, par une règle fixée à l'avance, puis mesuré **une seule fois** sur les trois jeux de test gelés, avec les quatre portes inchangées. Il n'y a ni réentraînement ni nouvelle génération.

### Où vit le seuil

- `services/veritas/config/thresholds.yaml` reçoit une section `models`, indexée par la référence du modèle :

  ```yaml
  models:
    VRT-DET-FR-0.4:
      likely_ai: <valeur issue de la règle>
  ```

- **Ce qui ne change pas** : `likely_human` (0,30), les marges de confiance et le seuil des fournisseurs, qui reste celui de `bands`.
- **Portée** : le seuil du modèle s'applique au document et aux phrases, comme aujourd'hui, en production, en mode fantôme et dans l'évaluation.
- **Lecture** : `Thresholds.for_model(reference)` renvoie les seuils du modèle et, à défaut, les seuils généraux. Le fichier reste relu à chaud.
- **Contrôle** : le chargement refuse un seuil de modèle hors de [0,70 ; 0,90] ou inférieur à `likely_human`. Le seuil reste lu depuis la configuration, jamais codé en dur (CLAUDE.md §5).

### Règle de choix

1. **Documents utilisés** : ceux de la partition `calibration` du corpus 0.4 français, notés document par document comme les jeux de test, soit :
   - 932 textes humains : 435 pages mC4, 185 pages universitaires et arrêts de 0.3, 312 ajoutés en 0.4 ;
   - environ 1 200 textes générés.
2. **Seuil retenu** : le plus petit sur la grille 0,70, 0,71, …, 0,90 qui donne **au plus 0,5 % de faux positifs** sur ces 932 textes, soit 4 au plus.
   - La cible est la moitié de la porte de 1 %. Wikipédia et les textes courts n'ont pas de partition de calibration, et la couche 3 a été ajustée sur ces mêmes documents, découpés en passages : les faux positifs y sont donc un peu sous-estimés.
3. **Aucun seuil de la grille ne convient** : rien ne change, FR 0.1 reste en place et la suite est FR 0.5 (de nouveaux textes humains de type web et encyclopédie).

### Mesure et décision

- **Mesure unique** : avec le seuil retenu, sur detection-v1, detection-v2 et detection-v3, avec les quatre portes d'ADR-0011 et ADR-0012, sans modification.
- **Contenu du rapport** :
  - le seuil et les faux positifs mesurés en calibration ;
  - chaque porte ;
  - la part « Indéterminé » des textes humains et des textes générés, qui mesure ce que coûte le nouveau seuil ;
  - les faux positifs par catégorie.
- **Toutes les portes franchies** : VRT-DET-FR-0.4 remplace VRT-DET-FR-0.1 en mode fantôme, avec son seuil. Servir seul reste soumis à la porte d'accord (ADR-0010) et à la vérification sur des textes réels (étape 3).
- **Une porte non franchie** : aucun nouvel essai de seuil sur ces jeux de test, et la suite est FR 0.5.

### Calcul

Un nouveau stage `threshold` du workflow `veritas-train`, avec `run: v4` et `languages: fr`, s'exécute sur un seul L4 :

1. il charge le paquet FR 0.4 depuis le volume `altydetect-veritas-models`, sans réentraînement ;
2. il note les documents de calibration ;
3. il applique la règle ;
4. il note de nouveau les trois jeux de test.

Il produit `threshold-VRT-DET-FR-0.4.json` et les rapports de test au nouveau seuil, poussés sur la branche de sorties habituelle.

## Conséquences

- **Coût** : environ 6 000 documents notés, soit 15 à 20 min de L4, **moins de 0,50 $** (plafond 1 $).
- **Plus de textes « Indéterminé »** : des textes générés qui seraient sortis « Probablement IA » à 0,70 deviennent « Indéterminé ». Repère sur les jeux de test, à titre indicatif seulement : à 0,85, le rappel hors Claude passerait d'environ 99 % à environ 98 %. Ce changement va dans le sens de la promesse produit (une probabilité, jamais un verdict).
- **Biais connu** : l'idée de relever le seuil vient de résultats déjà vus sur les jeux de test, en particulier la répartition des probabilités, et les valeurs testées à 0,80, 0,85 et 0,90. La règle fixe la valeur sur la calibration, sans choisir parmi ces chiffres. La mesure finale reste donc un peu optimiste. La vérification sur des textes réels (étape 3), indépendante de ces jeux, est le vrai contrôle.
- **Mécanisme réutilisable** : chaque modèle Veritas pourra recevoir son seuil de la même façon. Chaque seuil de modèle est consigné dans `docs/models/CHANGELOG.md` et dans la fiche du modèle.
- **Hors de cette décision** : le seuil `likely_human` et la zone « Indéterminé » des fournisseurs, qui ne changent pas.
- **Code à écrire après validation** :
  - `Thresholds.for_model` et ses tests ;
  - le passage du seuil du modèle dans l'aiguillage et le mode fantôme ;
  - le stage `threshold` ;
  - la fonction de choix, en fonction pure testée.
