# ADR-0009 — Entraînement de Veritas : corpus, Modal et lancement par GitHub Actions

- **Statut** : accepté
- **Date** : 2026-11-06
- **Décideurs** : équipe AltyDetect

## Contexte

Veritas VRT-DET-FR-0.1 et VRT-DET-EN-0.1 (ADR-0008) ont besoin d'un corpus de textes humains
et de textes générés, d'un GPU pour la couche 2 et d'un jeu de test gelé. Contraintes :
jamais de GPU permanent ; jamais de données brutes dans le dépôt ; aucun texte d'utilisateur
sans `training_opt_in` ; le modèle LLM n'est écrit que dans `packages/core/src/config/llm.ts`.

## Décision

- **Textes humains** : C4 et mC4 (`allenai/c4`, licence ODC-BY 1.0), exploration Common Crawl
  d'avril 2019, antérieure aux générateurs grand public. Pages nettoyées (prose seulement,
  180 à 900 mots, sans gabarit), dédupliquées par empreinte. Fragment 0 : entraînement et
  calibration ; fragment 1 : jeu de test gelé `detection-v1`.
- **Textes générés** : un texte par texte humain, même sujet, même genre, même longueur, écrit
  par Claude (modèle lu dans `config/llm.ts`) via l'API Message Batches (moitié prix),
  réflexion désactivée, effort faible.
- **Calcul** : tout tourne sur Modal. Corpus dans le volume `altydetect-veritas-corpus`, poids
  dans `altydetect-veritas-models`. La couche 2 s'entraîne sur un GPU L4 loué le temps du
  calcul ; en production, l'inférence est l'application `altydetect-veritas-encoder`, qui
  s'arrête après deux minutes sans requête.
- **Lancement** : le workflow manuel `.github/workflows/veritas-train.yml`. Le client Modal
  utilise gRPC, que l'environnement de développement infonuagique ne laisse pas passer ; un
  exécuteur GitHub le peut. Clés : secrets GitHub `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`,
  `ANTHROPIC_API_KEY` (recopiée dans le secret Modal `altydetect-anthropic`).
- **Sorties commitées** : manifestes du corpus (identifiant, empreinte, source, URL, licence,
  partition), paquet du modèle (`manifest.json`, sans les poids de l'encodeur), rapport de
  benchmark. Un essai `--run pilot` est isolé : corpus et références à part, jeu de test v1
  intact.

## Conséquences

- Coût d'un entraînement complet (4 400 + 1 000 textes humains par langue) : environ 11 000
  générations par lot, de l'ordre de 35 $ d'API Claude, et moins de 2 $ de GPU.
- Les textes générés viennent d'un seul générateur : le modèle 0.1 peut mal reconnaître les
  textes d'autres modèles. La comparaison avec le fournisseur externe en mode fantôme le
  mesure ; d'autres générateurs viendront dans une version suivante.
- Le jeu de test vient de la même distribution que l'entraînement : ses métriques sont un
  plafond, pas une promesse. La porte de la phase 3 reste l'accord en production (≥ 85 %).
