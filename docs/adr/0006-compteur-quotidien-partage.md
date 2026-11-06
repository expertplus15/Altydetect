# ADR-0006 — Compteur quotidien partagé entre Réécrire et Écrire

- **Statut** : accepté
- **Date** : 2026-11-05
- **Décideurs** : équipe AltyDetect

## Contexte

`plans.ts` fixe un quota quotidien de réécriture (3 en Gratuit, 300 en usage équitable pour Pro),
mais aucun quota pour les outils d'Écrire (plan, correction, résumé), qui appellent aussi le
modèle et ont un coût comparable. Laisser ces outils sans limite exposait le plan Gratuit à un
coût non borné ; inventer une seconde limite aurait créé une valeur non validée.

## Décision

Les outils d'Écrire qui appellent le modèle **partagent le compteur quotidien de Réécrire**
(`FREE_REWRITE_REQUESTS_PER_DAY`, `PRO_REWRITE_FAIR_USE_PER_DAY`). Les citations, mises en forme
sans modèle, ne comptent pas. Une demande est rendue si le traitement échoue.

## Conséquences

- Un seul compteur à afficher et à expliquer : « demandes du jour (Réécrire et Écrire) » sur la
  page Tarifs, l'écran Réécrire, la page Compte et les messages d'erreur.
- Un utilisateur Gratuit dispose de 3 demandes par jour au total.
- Si l'usage montre qu'Écrire mérite son propre quota, il suffira d'ajouter une constante dans
  `plans.ts` et un second compteur dans la table `usage` (nouvelle migration).
