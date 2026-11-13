# Changelog des modèles et des jeux de test

## 2026-11-13

- **Jeu de test `detection-v2`** (`ml/eval/testset/detection-v2`) : test de robustesse, par
  langue, 300 extraits Wikipédia de mars 2022, 100 textes humains et 100 textes de Claude
  courts (150 à 200 mots), 90 à 100 textes par modèle ouvert (Qwen2.5-7B, Mistral-7B v0.3,
  Phi-3.5-mini), 100 textes de Claude reformulés par Mistral, 100 textes mixtes. Nouvelle
  version, detection-v1 inchangé. Gelé : empreintes dans `MANIFEST.json`, vérifiées en test
  avec l'absence de tout document ou source issu du corpus d'entraînement. Manifestes sans
  texte ; textes dans le volume Modal `altydetect-veritas-corpus`.
- **VRT-DET-FR-0.1** et **VRT-DET-EN-0.1** mesurés sur detection-v2 (run 43356145940) :
  0 % de faux positifs sur 400 textes humains par langue ; Claude reconnu (99 à 100 %, même
  court) ; autres modèles mal reconnus (FR : Phi 83 %, Qwen 54 %, Mistral 3 % ; EN : 19 %,
  5 %, 4 %). Les modèles restent en mode fantôme. Rapports dans `docs/models/reports/`.

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
