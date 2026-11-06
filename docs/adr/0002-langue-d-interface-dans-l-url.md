# ADR-0002 — Langue d'interface dans l'URL (`/fr`, `/en`)

- **Statut** : accepté
- **Date** : 2026-11-04
- **Décideurs** : équipe AltyDetect

> Le numéro 0001 est réservé au choix du fournisseur de détection externe (phase 0).

## Contexte

L'interface existe en `fr` (par défaut) et `en` (CLAUDE.md, sections 2 et 8). La langue
d'interface est indépendante de la langue du texte analysé. next-intl propose deux modes :

1. **Préfixe dans l'URL** (`/fr/...`, `/en/...`), détecté par `proxy.ts` ;
2. **Sans préfixe**, langue lue dans un cookie ou dans le profil.

Le site public (accueil, tarifs, pages produit) doit être bien référencé dans les deux
langues, et un lien partagé doit s'ouvrir dans la langue de celui qui l'a partagé.

## Décision

Nous utilisons le **préfixe de langue dans l'URL** pour toutes les pages, avec `fr` par
défaut : `/` redirige vers `/fr` ou `/en` selon l'en-tête `Accept-Language` du navigateur
et le cookie de next-intl.

Quand l'authentification arrivera (Auth.js), la langue enregistrée sur le compte sera
appliquée à la connexion par une redirection vers le préfixe correspondant. Le sélecteur
FR | EN mettra à jour ce choix sur le compte.

## Conséquences

- Chaque page a une URL par langue : référencement correct (balises `hreflang`) et liens
  partagés stables.
- Les pages sont générées statiquement par langue (`generateStaticParams`).
- Toutes les routes de pages vivent sous `app/[locale]/` ; les routes `/api/*` et
  `/internal/*` ne sont pas préfixées (exclues dans `proxy.ts`).
- Les liens internes utilisent `Link` de `@/i18n/navigation`, jamais celui de `next/link`,
  pour conserver la langue.
