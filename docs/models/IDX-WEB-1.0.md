# Fiche moteur — IDX-WEB-1.0 et IDX-PRV-1.0 (Indexa, plagiat)

- **Références** : `IDX-WEB-1.0` (web), `IDX-PRV-1.0` (base privée)
- **Date** : 2026-11-05
- **Code** : `services/indexa`
- **Jeu de test** : `ml/eval/testset/plagiarism-v1` (56 cas, gelé, licence CC0)
- **Benchmark** : `pnpm benchmark:plagiarism`

## Méthode

1. Découpage en mots normalisés (minuscules, sans accents ni ligatures), positions conservées.
2. Empreintes de n-grammes de 5 mots (hachage 64 bits), winnowing (fenêtre 4) pour l'index
   de la base privée.
3. Web : jusqu'à 8 extraits de 12 mots, tirés des phrases les plus distinctives, recherchés
   en citation exacte (Brave Search API, ADR-0007) ; 10 pages lues au plus.
4. Alignement par diagonales de n-grammes communs, fusion des morceaux séparés de 6 mots au
   plus, passages de 8 mots minimum ; score = part du passage retrouvée mot pour mot.
5. Similarité = part des mots du texte couverts par au moins un passage.

## Résultats sur plagiarism-v1

| Mesure                                                                       | Valeur                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Rappel (copie exacte, retouches légères, phrases déplacées, copie partielle) | **100 %**                                                                           |
| Rappel par catégorie                                                         | copie exacte 100 % · retouches 100 % · déplacées 100 % · partielle 100 %            |
| Rappel sur paraphrase forte (mesuré à part)                                  | 0 %                                                                                 |
| Précision des passages                                                       | 100 %                                                                               |
| Faux positifs sur textes originaux                                           | 0 % (0 sur 6)                                                                       |
| Requêtes de recherche par document                                           | 5,64                                                                                |
| Pages lues par document                                                      | 0,86                                                                                |
| Coût de recherche par document                                               | 5,64 × prix unitaire Brave (prix à renseigner : `INDEXA_SEARCH_PRICE_PER_1000_EUR`) |
| Latence par document (hors réseau)                                           | ≈ 15 ms                                                                             |

**Porte de sortie** : `RECALL_THRESHOLD` reste à fixer (TODO dans
`ml/eval/plagiarism/benchmark.py`). Avec un seuil inférieur ou égal à 100 %, elle est atteinte
sur ce jeu.

## Limites à connaître

- **Recherche simulée** : le benchmark remplace Brave par un moteur de phrases exactes sur le
  corpus du jeu. Il mesure Indexa (choix des requêtes, alignement), pas le rappel réel du web,
  qui dépendra de l'index de Brave. Une mesure avec la vraie API est à faire dès que la clé
  est disponible, sur un échantillon de pages réelles.
- **Paraphrase forte** : hors de portée d'un alignement par mots (0 %). Une détection
  sémantique (plongements, pgvector) est la piste pour une version 2.
- **Jeu de test petit et rédigé pour l'occasion** : 12 sources, 56 cas. Il garantit la
  non-régression, pas la représentativité ; un jeu plus large (documents réels sous licence)
  donnera une version `plagiarism-v2`.
