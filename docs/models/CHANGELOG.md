# Changelog des modèles et des jeux de test

## 2026-11-11

- **Jeu de test `detection-v1`** (`ml/eval/testset/detection-v1`) : par langue (fr, en),
  1 000 pages C4 / mC4 (fragment 1) et 1 000 textes générés appariés. Gelé : empreintes dans
  `MANIFEST.json`, vérifiées en test avec l'absence de recouvrement avec le corpus
  d'entraînement (`ml/corpus/manifests/veritas-0.1`).
- **VRT-DET-FR-0.1** et **VRT-DET-EN-0.1** : premiers modèles Veritas (run v1
  42928107614). Faux positifs 0,4 % (FR) et 0 % (EN), rappel 100 % et 99,9 %. Fiches :
  `VRT-DET-FR-0.1.md`, `VRT-DET-EN-0.1.md`. Pas encore activés en production.

## 2026-11-05

- **Jeu de test `plagiarism-v1`** (`ml/eval/testset/plagiarism-v1`) : 56 cas (copie exacte,
  retouches légères, phrases déplacées, copie partielle, paraphrase forte, textes originaux),
  12 sources rédigées pour AltyDetect (CC0). Gelé : empreintes SHA-256 dans `MANIFEST.json`,
  vérifiées par le benchmark.
- **IDX-WEB-1.0 / IDX-PRV-1.0** : première version d'Indexa. Fiche : `IDX-WEB-1.0.md`.
