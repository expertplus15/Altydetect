# ADR-0012 — Veritas FR 0.3 : textes humains de registre soutenu

- **Statut** : proposé
- **Date** : 2026-11-13
- **Décideurs** : équipe AltyDetect

## Contexte

VRT-DET-FR-0.2 (ADR-0011) reconnaît tous les générateurs mesurés, y compris Phi-3.5-mini
jamais vu, mais classe « Probablement IA » 8 % des extraits Wikipédia et 2,5 % des pages mC4
de `detection-v1` : 3,7 % de faux positifs, au-dessus de la porte de 1 %. VRT-DET-FR-0.1 reste
en place.

Cause probable : un biais de registre. Les textes humains du corpus sont des pages web
(mC4, 2019), souvent familières ; les textes générés, quel que soit le modèle, sont rédigés
avec soin, même quand la consigne demande « une page web ». Le modèle a appris que le
registre soutenu signale un texte généré. VRT-DET-EN-0.2 n'a pas ce défaut (0 % sur
Wikipédia), la cause est donc propre au corpus français.

Objectif du projet (décision du 13/11/2026) : Veritas seul détecteur, sans fournisseur
externe, une fois FR 0.3 et une vérification sur des textes réels franchies. Cet ADR couvre
FR 0.3 seulement.

## Décision proposée

**Ajouter des textes humains français de registre soutenu, et autant de textes générés dans
les mêmes registres**. Sans la seconde moitié, le modèle apprendrait l'inverse (« registre
soutenu = humain ») et laisserait passer les textes générés soignés.

### Sources humaines (à valider)

| Source                                                                         | Registre                         | Licence                                                        | Filtre de date           |
| ------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------- | ------------------------ |
| `PleIAs/French-Science-Commons` (HAL, OpenAlex)                                | universitaire (articles, thèses) | par document : CC BY, CC BY-SA, CC0, Licence ouverte seulement | publication ≤ 30/06/2022 |
| `antoinejeannot/jurisprudence` (Judilibre, Cour de cassation et cours d'appel) | juridique, administratif         | Licence ouverte 2.0 (Etalab)                                   | décision ≤ 30/06/2022    |

- **Date** : avant les assistants grand public (fin 2022), comme C4 (2019) et Wikipédia
  (mars 2022) : aucune contamination par des textes générés.
- **Licences** : seules les licences qui autorisent la réutilisation commerciale ; les
  documents NC, ND ou « tous droits réservés » de HAL sont écartés document par document.
- **Wikipédia exclue** : elle reste la mesure indépendante du registre encyclopédique dans
  `detection-v2`. L'entraîner dessus fausserait cette mesure.
- **Écartées** : fiches service-public.fr (versions de 2025, rédaction possiblement assistée,
  pas de date d'écriture) ; débats parlementaires disponibles sans date ; livres du domaine
  public (orthographe et style anciens, autre biais).
- **Vérifié le 13/11/2026** (métadonnées seulement) : un fichier sur 350 de French Science
  Commons compte 97 000 pages, dont 80 % en français, toutes sous CC BY, CC BY-SA, CC0,
  Licence ouverte ou domaine public, environ la moitié publiées avant 2023 ; les sources
  comprennent DUMAS (mémoires d'étudiants) et TEL (thèses), proches des usages visés. La
  base Judilibre compte 553 000 décisions de la Cour de cassation, en majorité avant 2022.
- **archive.org écarté** : 224 600 textes français datés de 1990 à mi-2022, mais presque
  tous sous droits (bibliothèque de prêt). Sur 9 000 textes sous licence Creative Commons
  examinés, 1 955 autorisent l'usage commercial, dont 1 381 PDF de Wikipédia (exclue) ; le
  reste est hétérogène (numérisations, magazines, bandes dessinées) et la licence est déclarée
  par la personne qui a déposé le fichier, sans contrôle.
- **Nettoyage** : French Science Commons est issu d'une reconnaissance de PDF en Markdown.
  Seuls les paragraphes de prose sont gardés (pas de titres, tableaux, formules, références,
  notes, césures). Sinon le modèle apprendrait « bruit de numérisation = humain ». Mêmes
  règles de longueur que mC4 (180 à 900 mots).

### Textes générés appariés

Un texte généré par texte humain, sur le même sujet et dans le même genre, par les modèles
ouverts d'ADR-0011 (Qwen2.5-7B, Mistral-7B v0.3, Granite-3.3-8B, répartis uniformément).
Consignes propres au genre (« extrait d'article scientifique », « motivation d'une décision de
justice ») au lieu de « page web ». Phi-3.5-mini reste tenu à l'écart. Aucun appel à l'API
Claude.

### Effectifs (français seulement)

| Partie                                      | Humains | Générés |
| ------------------------------------------- | ------- | ------- |
| Universitaire : entraînement et calibration | 1 000   | 1 000   |
| Juridique : entraînement et calibration     | 1 000   | 1 000   |
| Universitaire : test                        | 200     | 200     |
| Juridique : test                            | 200     | 200     |

Les parties test forment un nouveau jeu gelé, **`detection-v3/fr`** (registre soutenu),
versionné dans `docs/models/CHANGELOG.md` ; `detection-v1` et `detection-v2` ne changent pas.
Le reste du corpus 0.2 français (12 697 documents) est repris tel quel.

### Entraînement

Mêmes réglages que 0.2 (ADR-0011). Préparation des passages sur CPU avant de réserver le GPU :
le run 0.2 a perdu ≈ 30 min de L4 par langue à cette étape.

### Portes de sortie

Les quatre portes d'ADR-0011, mêmes seuils. Seul changement : la porte des faux positifs
compte aussi les 400 textes humains de `detection-v3/fr`, et le rappel « générateurs vus »
compte les 400 textes générés de `detection-v3/fr`. Le rapport donne aussi le taux de faux
positifs sur Wikipédia seule, la mesure du défaut à corriger.

## Conséquences

- **Coût estimé** (tarifs Modal du 10/11/2026, L4 à 0,80 $/h ; débits mesurés en 0.2) :
  2 400 générations ≈ 6 à 7 h de L4, soit ≈ 5 à 6 $ ; entraînement ≈ 1 h de L4, ≈ 1 $ ;
  préparation CPU négligeable. **Total ≈ 6 à 8 $, plafond 15 $.**
- **Durée** : ≈ 1 h 30 pour le corpus (8 L4 en parallèle), ≈ 1 h 15 pour l'entraînement.
- **Première étape sans GPU** : un inventaire des sources (nombre de documents éligibles par
  licence et par date, longueurs) avant toute génération, pour vérifier les effectifs.
- Si FR 0.3 franchit les portes : il remplace FR 0.1, puis vient la vérification sur des
  textes réels (étape 3 du plan). Sinon : analyse par source et nouvel ADR.
- Limite : le registre soutenu ne couvre pas tous les usages (copies d'étudiants, lettres de
  motivation, courriels). La vérification sur des textes réels doit en comprendre.
