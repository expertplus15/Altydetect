# Fiche modèle — VRT-DET-EN-0.2 (Veritas, détection IA, anglais)

- **Référence** : `VRT-DET-EN-0.2`
- **Date** : 2026-11-13
- **Statut** : **retenu** pour remplacer VRT-DET-EN-0.1 en mode fantôme (ADR-0011, portes de
  sortie franchies). Pas encore activé : remplacement du paquet et déploiement de la couche 2
  dans une PR à part.
- **Run** : [43425145321](https://github.com/expertplus15/Altydetect/actions/runs/43425145321)
  (run `v2`, étape `train`) ; corpus : run
  [43366022743](https://github.com/expertplus15/Altydetect/actions/runs/43366022743)
- **Paquet** : volume Modal `altydetect-veritas-models`, dossier `VRT-DET-EN-0.2` (manifeste et
  poids de l'encodeur, jamais dans le dépôt) ; manifeste aussi sur la branche
  `ml/sorties-v2-43425145321`
- **Jeux de test** : `ml/eval/testset/detection-v1/en.jsonl`,
  `ml/eval/testset/detection-v2/en.jsonl` (robustesse), gelés
- **Rapports** : `docs/models/reports/detection-v1-VRT-DET-EN-0.2.json`,
  `docs/models/reports/robustness-detection-v2-VRT-DET-EN-0.2.json`
- **Voir aussi** : `VRT-DET-EN-0.1.md`, `VRT-DET-FR-0.2.md`, ADR-0011

## Méthode (ADR-0008, réglages d'ADR-0011)

1. Couche 1 : 9 traits stylométriques, régression logistique (CPU).
2. Couche 2 : `microsoft/deberta-v3-base` affiné 2 époques (3684 pas, perte finale 0,215),
   lissage des étiquettes 0,1, classes équilibrées, GPU L4.
3. Couche 3 : combinaison logistique des deux logits (C = 1, classes équilibrées), ajustée sur
   la partition de calibration.
4. Bandes : seuils de `services/veritas/config/thresholds.yaml` (IA ≥ 0,70, humain ≤ 0,30),
   inchangés.

## Corpus 0.2

| Partition    | Documents                           | Passages |
| ------------ | ----------------------------------- | -------- |
| Entraînement | 11 485                              | 29 462   |
| Calibration  | 1 276                               | 3 224    |
| Test (gelé)  | 2000 (1 000 humains, 1 000 générés) | —        |

Corpus v1 (C4 et Claude Sonnet 5.5) inclus à l'identique, plus 2 362 textes de modèles
ouverts (Qwen2.5-7B, Mistral-7B v0.3, Granite-3.3-8B, OLMo-2-7B), 599 textes de Claude
reformulés par ces modèles et 1 000 textes mixtes (fenêtres étiquetées de part et d'autre de
la frontière). Phi-3.5-mini n'est jamais utilisé. Manifestes sans texte :
`ml/corpus/manifests/veritas-0.2/en.jsonl`.

## Résultats sur detection-v1

| Mesure                                             | 0.2                          | 0.1     |
| -------------------------------------------------- | ---------------------------- | ------- |
| Précision (« Probablement IA »)                    | 99,8 %                       | 100,0 % |
| Rappel                                             | 100,0 %                      | 99,9 %  |
| Faux positifs sur textes humains                   | **0,2 % (2 sur 1 000)**      | 0 %     |
| Borne haute à 95 % des faux positifs               | 0,7 %                        | 0,4 %   |
| « Indéterminé »                                    | humains 0,0 %, générés 0,0 % | 0 %     |
| AUROC                                              | 0,9993                       | 1,0     |
| Latence par document (GPU L4 chaud, couches 1 à 3) | 219 ms                       | 214 ms  |

## Robustesse sur detection-v2

Mêmes seuils que la production. Part des textes par bande, et part « Probablement IA » de 0.1
pour comparaison.

| Catégorie                         | Textes | « Probablement IA » | « Indéterminé » | « Probablement humain » | 0.1   |
| --------------------------------- | ------ | ------------------- | --------------- | ----------------------- | ----- |
| Humains : Wikipédia (mars 2022)   | 300    | **0 %**             | 0 %             | 100 %                   | 0 %   |
| Humains : courts (150-200 mots)   | 100    | **0 %**             | 0 %             | 100 %                   | 0 %   |
| Claude : courts (150-200 mots)    | 100    | **100 %**           | 0 %             | 0 %                     | 99 %  |
| Claude reformulé par Mistral      | 100    | **100 %**           | 0 %             | 0 %                     | 100 % |
| Qwen2.5-7B-Instruct               | 96     | **100 %**           | 0 %             | 0 %                     | 5 %   |
| Mistral-7B-Instruct-v0.3          | 100    | **100 %**           | 0 %             | 0 %                     | 4 %   |
| Phi-3.5-mini-instruct (jamais vu) | 100    | **100 %**           | 0 %             | 0 %                     | 19 %  |
| Mixtes (début humain, fin Claude) | 100    | 43 %                | 3 %             | 54 %                    | 15 %  |

## Portes de sortie (ADR-0011)

| Porte                                                   | Seuil  | Mesuré | Franchie |
| ------------------------------------------------------- | ------ | ------ | -------- |
| Faux positifs, tous textes humains (detection-v1 et v2) | ≤ 1 %  | 0,14 % | oui      |
| Rappel sur Claude (detection-v1)                        | ≥ 95 % | 100 %  | oui      |
| Rappel sur les générateurs vus                          | ≥ 80 % | 100 %  | oui      |
| Rappel sur le générateur inconnu (Phi-3.5-mini)         | ≥ 60 % | 100 %  | oui      |

## Limites à connaître

- **Scores de 100 % à confirmer hors laboratoire.** Les jeux de test sont produits comme le
  corpus (mêmes consignes, même nettoyage, sujets de même origine). Les textes d'assistants
  commerciaux autres que Claude (ChatGPT, Gemini) et les textes retouchés à la main ne sont pas
  mesurés ; un contrôle externe sur un échantillon reste à faire.
- **Probabilités toujours tranchées** : « Indéterminé » reste presque vide (0 à 3 %). Le
  lissage des étiquettes n'a pas suffi.
- **Textes mixtes** : 43 % « Probablement IA », 54 % « Probablement humain ». Le score du
  document ne dit pas quelle partie est générée ; l'analyse par phrase n'est pas mesurée ici.
- **Écart avec le fournisseur externe : non mesuré.** Servir seul reste soumis à la porte
  d'accord de la phase 3 (ADR-0010).
