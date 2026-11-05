# ADR-0007 — Recherche web du moteur de plagiat : Brave Search API

- **Statut** : accepté
- **Date** : 2026-11-05
- **Décideurs** : équipe AltyDetect

## Contexte

Indexa compare un texte au web (`scope: web`). Il ne peut pas indexer le web lui-même : il
interroge un moteur de recherche avec des passages distinctifs du texte, télécharge les pages
trouvées et les aligne avec le texte. Il faut une API de recherche fiable, avec un index en
français et en anglais, un prix à la requête et des conditions qui autorisent cet usage.

Options : Brave Search API, Exa, SerpAPI (résultats Google revendus), Google Programmable
Search (fermé aux nouveaux usages de recherche sur tout le web), Bing Web Search (arrêté).

## Décision

Nous utilisons **Brave Search API** (point d'accès Web Search) derrière une interface
`SearchProvider` dans `services/indexa/src/indexa/web/search.py`. Le fournisseur actif se choisit
par `INDEXA_SEARCH_PROVIDER` ; les tests utilisent un fournisseur simulé.

- Requêtes : phrases exactes (entre guillemets) choisies parmi les plus distinctives du texte,
  au plus `INDEXA_MAX_QUERIES` par analyse.
- Pages : téléchargées avec une protection réseau (adresses publiques seulement, taille et délai
  bornés), texte extrait sans dépendance externe, jamais conservé.
- Coût par analyse = nombre de requêtes × prix unitaire (`INDEXA_SEARCH_PRICE_PER_1000_EUR`,
  valeur TODO jusqu'à la souscription), mesuré par le benchmark.

## Conséquences

- Index indépendant de Google et Bing, conditions compatibles avec un usage commercial
  (à confirmer à la souscription de l'offre « Data for AI » si nécessaire).
- La qualité dépend du rappel de Brave sur des passages exacts ; le benchmark du jeu de test
  plagiat le mesure. Un second fournisseur peut être ajouté sans toucher au reste d'Indexa.
- Une clé `BRAVE_SEARCH_API_KEY` est nécessaire en production ; sans elle, le périmètre `web`
  renvoie une erreur explicite et la base privée reste utilisable.
