# ADR-0001 — Fournisseur de détection externe

- **Statut** : proposé. Passe à « accepté » quand les conditions de la section « Décision » sont remplies.
- **Date** : 2026-11-04
- **Décideurs** : équipe AltyDetect

## Contexte

En phase 3, la détection est servie en production par un fournisseur externe pendant que
Veritas (`VRT-DET-FR`, `VRT-DET-EN`) s'entraîne en arrière-plan. L'adaptateur
`DetectionProvider` prévoit trois implémentations : Copyleaks, GPTZero, Pangram. Il faut en
choisir un comme fournisseur actif (`DETECTION_PROVIDER`) et un de repli.

Critères, par ordre d'importance :

1. **Droit d'afficher les scores à nos clients** dans un SaaS commercial sous notre marque.
2. **Faux positifs bas sur des textes humains**, en français et en anglais (promesse :
   une probabilité, pas une preuve).
3. **Sortie compatible avec notre contrat** : probabilités, confiance, scores par segment,
   une classe intermédiaire pour alimenter « Indéterminé ».
4. **Données** : pas d'entraînement sur les textes soumis, conservation minimale, DPA,
   hébergement ou transfert conforme au RGPD.
5. **Coût par mot** et limites techniques (longueur, débit, mode asynchrone).

## Comparatif

Sources : pages publiques des fournisseurs et études citées, consultées en novembre 2026.
Les chiffres des fournisseurs sont déclaratifs. Tout reste à confirmer par écrit (voir
« Questions aux fournisseurs »).

| Critère                               | Pangram                                                                                                                       | Copyleaks                                                                                         | GPTZero                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Revente / affichage sous notre marque | **Bloquant** : CGU limitées à un « usage interne », non sous-licenciable. Contrat écrit nécessaire                            | **Prévu** : programme revendeurs, API en marque blanche                                           | Inconnu                                                                                                          |
| Précision (indépendant)               | Meilleurs résultats de l'étude BFI, Université de Chicago (WP 2025-116, anglais) : presque aucun faux positif ni faux négatif | Absent de l'étude BFI                                                                             | Faible face aux textes reformulés (environ 50 % de textes IA non détectés, selon un compte rendu de l'étude BFI) |
| Français                              | Pris en charge. Faux positifs FR très bas selon le fournisseur                                                                | Pris en charge. Moins bon que Pangram dans un benchmark multilingue publié par GPTZero (partial)  | Pris en charge selon le fournisseur                                                                              |
| Sortie                                | Parts IA / assisté par IA / humain, fenêtres avec confiance et positions                                                      | Score IA et passages surlignés (format exact à vérifier)                                          | Probabilités humain / IA / mixte, score par phrase                                                               |
| Longueur minimale                     | 50 mots                                                                                                                       | ≈ 255 caractères (non officiel)                                                                   | Non publiée                                                                                                      |
| Asynchrone / fichiers                 | API Bulk par sondage, pas de webhook                                                                                          | Webhooks, fichiers, OCR                                                                           | Fichiers, lots (non officiel)                                                                                    |
| Données / RGPD                        | Pas d'entraînement sur les textes soumis (politique de confidentialité). SOC 2, DPA et hébergement UE non vérifiés            | SOC 2 et SOC 3, centre de données dans l'UE (Allemagne), pas d'entraînement sur les textes soumis | SOC 2 Type II. DPA et hébergement UE non vérifiés                                                                |
| Prix public                           | Crédits prépayés. **Tarif ambigu** sur deux pages officielles (0,05 $ pour 100 ou pour 1 000 mots)                            | Sur devis pour l'API entreprise                                                                   | ≈ 0,46 $ pour 1 000 mots en dépassement                                                                          |

Le français n'a fait l'objet d'aucune étude indépendante qui compare les trois fournisseurs :
il faut mesurer nous-mêmes.

## Décision

Nous proposons **Pangram comme fournisseur principal** et **Copyleaks comme fournisseur de
repli**. GPTZero n'est pas retenu en l'état.

Cette proposition devient une décision acceptée seulement si les trois conditions sont remplies :

1. **Contrat Pangram signé** autorisant l'affichage des scores à nos clients sous notre
   marque, avec DPA, clauses contractuelles types pour le transfert hors UE, aucune
   utilisation pour l'entraînement et conservation nulle ou bornée. **Si Pangram refuse,
   Copyleaks devient le fournisseur principal.**
2. **Benchmark interne** des deux fournisseurs sur le jeu de test gelé `ml/eval/testset/`
   (FR et EN) : taux de faux positifs sur textes humains, rappel, robustesse aux textes
   reformulés, latence. Résultats consignés dans `docs/models/`.
   Outil : `ml/eval/detection/provider_benchmark.py` (workflow « Entraînement Veritas »,
   étape `benchmark`) : échantillon du jeu `detection-v1`, fournisseur et Veritas 0.1 notés
   sur les mêmes textes, accord des bandes. Usage interne seulement : aucun score montré à
   un client, compatible avec les CGU « usage interne » de Pangram.
3. **Prix confirmés par écrit**, et intégrés dans `config/` en remplaçant les valeurs `TODO`.

Jusque-là, `DETECTION_PROVIDER` reste `TODO` dans `.env.example`.

## Conséquences

- Les implémentations `PangramProvider` et `CopyleaksProvider` sont prioritaires dans
  `services/veritas/providers/`. `GPTZeroProvider` attend. L'interface `DetectionProvider`
  ne change pas.
- La classe « assistée par IA » de Pangram (ou son équivalent chez Copyleaks) alimente la
  part `undetermined` du contrat. La correspondance exacte est une règle de l'aiguillage,
  testée et réglée dans la configuration.
- Le seuil `TEXT_TOO_SHORT` (150 mots) reste au-dessus des minimums des deux fournisseurs.
- Pangram n'a pas de webhook : les analyses longues sondent l'API Bulk depuis la file de
  tâches (RQ).
- Novembre 2026 : Pangram a déprécié `POST /v3`. L'adaptateur utilise l'API asynchrone
  (`POST /task`, puis `GET /task/{id}`) sur `text.external-api.pangram.com`, sélecteur
  `pangram-4` (`PANGRAM_MODEL`). `GET /balance`, `/usage` et `/limits` sont gratuits.
- Changer de fournisseur reste une variable d'environnement. Cette décision peut être
  revue sans toucher au reste du code.

## Questions aux fournisseurs

1. Autorisez-vous l'intégration et l'affichage de vos scores dans un SaaS tiers sous notre
   marque ? Faut-il vous citer ? Y a-t-il une clause de non-concurrence, sachant que nous
   entraînons notre propre modèle ?
2. Quel est le tarif exact par mot (pour Pangram : 100 ou 1 000 mots ?), avec les paliers de
   volume et l'engagement minimum ?
3. Pouvez-vous fournir un DPA, le rapport SOC 2, la liste des sous-traitants et les régions
   d'hébergement ? Le traitement peut-il rester dans l'UE ? Quelle est la conservation
   réelle, sauvegardes et journaux compris ?
4. Garantissez-vous par écrit que les textes soumis ne servent jamais à l'entraînement ?
5. Avez-vous des métriques en français, notamment le taux de faux positifs sur des textes
   académiques ou écrits par des non-natifs ? Peut-on avoir un accès d'essai pour notre benchmark ?
6. Quelles sont les longueurs minimale et maximale, les codes d'erreur, les limites de
   débit, la latence garantie et le SLA ?
7. Proposez-vous des webhooks, un mode lot et l'analyse de fichiers PDF et DOCX ?
8. Comment versionnez-vous vos modèles, et avec quel préavis avant un changement ?

## Sources

- Pangram : docs.pangram.com (API de détection, API Bulk), pangram.com (tarifs, offre
  Developers, tailles d'entrée, fiche du modèle 4.1, CGU du 14/08/2025, politique de
  confidentialité).
- Copyleaks : docs.copyleaks.com (langues prises en charge, sécurité, notes de version),
  copyleaks.com (API de détection, revendeurs, tarifs).
- GPTZero : support.gptzero.me (limites de débit, dépassements), gptzero.me (sécurité, FAQ,
  benchmark multilingue).
- Jabarian et Imas, BFI Working Paper 2025-116, Université de Chicago (NBER w34223).
- Dugan et al., RAID, ACL 2024 (arXiv 2405.07940).
