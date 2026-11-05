# ADR-0005 — Bibliothèque PDF : @react-pdf/renderer

- **Statut** : accepté
- **Date** : 2026-11-05
- **Décideurs** : équipe AltyDetect

> La demande initiale citait « ADR-0004 bibliothèque PDF » ; 0004 décrit l'éditeur.

## Contexte

Pro inclut l'export PDF d'une réécriture : texte d'origine, proposition retenue, registre,
intensité, date et horodatage. Le PDF doit être lisible en français (accents, guillemets,
espaces insécables), produit côté serveur, et l'export passe par la file de tâches
(CLAUDE.md §4.9). Options : @react-pdf/renderer, PDFKit, un navigateur sans tête (Playwright,
Puppeteer) qui imprime une page HTML.

## Décision

Nous utilisons **@react-pdf/renderer** dans `packages/reports`, exécuté par le worker BullMQ
(`apps/web/worker/index.ts`, file `reports`).

- Mise en page déclarative en composants React, cohérente avec le reste du code.
- Police Inter **statique** (Regular et SemiBold, licence OFL) embarquée dans le package : la
  version variable fait échouer le sous-ensemble de polices du moteur PDF.
- Le texte d'origine n'est pas stocké : le navigateur l'envoie pour l'export, il transite dans
  le job et en est effacé dès la génération.
- Le PDF est gardé **15 minutes** dans Redis et servi par un lien signé (HMAC) et expirant,
  réservé à son auteur. Pas de stockage objet (R2) pour ce besoin : un fichier éphémère de
  quelques dizaines de Ko n'a pas à être conservé.

## Conséquences

- Pas de navigateur sans tête à installer ni à maintenir sur le worker : image plus légère,
  démarrage rapide, coût faible par rapport.
- Mise en page plus limitée que du HTML imprimé (pas de CSS complet) : suffisant pour des
  rapports textuels. À réévaluer pour le rapport combiné détection + plagiat de la phase 2.
- Un worker doit tourner en production à côté du serveur web (`pnpm -C apps/web worker`).
- Si les rapports doivent un jour être conservés ou partagés, ils passeront dans R2, avec
  le même lien signé.
