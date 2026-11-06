# ADR-0008 — Architecture de Veritas : trois couches, aiguillage et mode fantôme

- **Statut** : accepté
- **Date** : 2026-11-06
- **Décideurs** : équipe AltyDetect

## Contexte

En phase 3, la détection est servie par un fournisseur externe (ADR-0001) pendant que Veritas
`VRT-DET-FR-0.1` et `VRT-DET-EN-0.1` s'entraîne et tourne en arrière-plan. La porte de sortie de
la phase : un accord d'au moins **85 %** entre Veritas et le fournisseur sur un segment, et moins
de **1 %** de faux positifs sur les textes humains du jeu de test gelé.

Contraintes : jamais de GPU permanent (CLAUDE.md §2) ; le texte n'est jamais écrit en base
(§4.5) ; un résultat est une probabilité avec confiance et zone « indéterminé », jamais un
verdict (§1) ; seuils et règles d'aiguillage modifiables sans redéploiement (§6).

## Décision

### Trois couches

1. **Couche 1, statistique, sur CPU** : longueur et régularité des phrases, richesse du
   vocabulaire, ponctuation, mots outils, répétitions. Régression logistique (scikit-learn),
   quelques millisecondes, toujours disponible dans le processus de Veritas.
2. **Couche 2, encodeur affiné** : CamemBERT-base pour le français, DeBERTa-v3-base pour
   l'anglais, affinés sur `ml/corpus`. Inférence par fenêtres de phrases sur **Modal** (GPU à la
   demande, mis à l'échelle jusqu'à zéro) ; sur CPU en développement.
3. **Couche 3, calibration** : les scores des couches 1 et 2 sont combinés puis calibrés
   (régression isotonique ou Platt) sur un jeu de calibration distinct du jeu de test gelé. La
   sortie est une probabilité, par phrase et pour le document.

Un modèle livré est un **paquet versionné** (`manifest.json` + poids), désigné par sa référence
`VRT-DET-[FR|EN]-x.y` et chargé depuis `VERITAS_MODEL_DIR`. Sans paquet pour une langue, Veritas
est indisponible pour cette langue et l'aiguillage le sait.

### Une seule normalisation

Veritas et chaque fournisseur rendent un même résultat brut : probabilité du document,
probabilités par passage (positions dans le texte) et, s'il y en a, parts IA / assisté / humain.
`veritas/scoring.py` le transforme en sortie du contrat avec les seuils de
`services/veritas/config/thresholds.yaml` :

- chaque phrase reçoit la probabilité des passages qui la recouvrent, puis une bande
  (`likely_ai`, `undetermined`, `likely_human`) ;
- `overall` = parts du texte (en mots) dans chaque bande, ou les parts données par le
  fournisseur (la classe « assisté par IA » de Pangram alimente `undetermined`, ADR-0001) ;
- `confidence` dépend de l'écart de la probabilité au milieu et de la longueur du texte ;
- `verdict_band` vient des seuils ; une confiance faible donne toujours `undetermined`.

### Aiguillage et mode fantôme

`services/veritas/router.py` lit `services/veritas/config/routing.yaml` (relu à chaque
modification, sans redéploiement). Il choisit un segment (langue, longueur, offre) et un mode
de service : `external`, `veritas` ou `both`. Le mode `deep` demande toujours les deux avis.

- **Externe seul** : cas par défaut en phase 3. Si Veritas dispose d'un modèle pour la langue,
  une comparaison est mise en file (RQ, file `veritas-shadow`) : le texte passe par une clé
  Redis lue et supprimée en une opération, comme pour Indexa.
- **Veritas seul** : quand un segment est promu. Si sa confiance est sous le minimum du
  segment, l'aiguillage demande aussi l'avis externe.
- **Les deux, concordants** (même bande) : le principal répond, l'autre est cité.
- **Les deux, discordants** : le résultat passe en `undetermined` avec une confiance faible.

Chaque fois que les deux ont tourné, la comparaison est enregistrée dans
`detection_comparisons` : segment, langue, nombre de mots, probabilités, bandes, accord. Jamais
le texte. `GET /internal/v1/detect/agreement` donne le taux d'accord par segment et indique si
le seuil de 85 % est atteint.

## Conséquences

- Promouvoir un segment vers Veritas = modifier `routing.yaml`, sans déploiement.
- Le coût GPU n'existe qu'à l'entraînement et lors des inférences de la couche 2.
- Les seuils de `thresholds.yaml` sont provisoires jusqu'à la calibration sur le jeu de test
  gelé ; leur changement est consigné dans `docs/models/CHANGELOG.md`.
- Nouvelles dépendances Python : PyYAML (configuration), scikit-learn (couches 1 et 3),
  Transformers et PyTorch (couche 2, entraînement), Modal (inférence et entraînement).
