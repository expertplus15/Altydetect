# ADR-0004 — Éditeur de texte : Tiptap

- **Statut** : accepté
- **Date** : 2026-11-05
- **Décideurs** : équipe AltyDetect

> La demande initiale citait « ADR-0002 éditeur » ; 0002 décrit déjà la langue dans l'URL.

## Contexte

L'interface repose sur un éditeur unique (CLAUDE.md §8) : coller ou importer un texte, compter
les mots en temps réel, remplacer le texte par une proposition de réécriture, et, en phase 3,
surligner des phrases avec un score de détection sans casser la saisie. Le collage doit être
propre (texte brut). Options : `contenteditable` maison, Tiptap (ProseMirror), Lexical, Slate.

## Décision

**Tiptap 3** (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extensions`), sans extension payante.

En une ligne : Tiptap gère la sélection, l'historique et le collage de façon fiable, et ses
décorations ProseMirror permettront le surlignage par phrase de la phase 3 sans toucher au texte.

Réglages : paragraphes, titres de niveaux 2 et 3, gras, italique et listes ; pas de code ni de
liens. Le collage ne garde que le texte brut. Le texte transmis aux API est `getText()` avec des
paragraphes séparés par une ligne vide ; les mots sont comptés par `countWords`
(`@altydetect/core`), la même fonction que les quotas.

## Conséquences

- Environ 100 Ko de JavaScript compressé en plus sur les pages de l'espace de travail
  (aucune sur le site public) : acceptable pour un outil d'écriture.
- Un `contenteditable` maison aurait demandé de refaire la gestion du collage, de l'annulation et
  de la sélection, avec des écarts entre navigateurs.
- Les surlignages de la phase 3 seront des décorations, pas des marques : le texte de l'utilisateur
  reste intact.
