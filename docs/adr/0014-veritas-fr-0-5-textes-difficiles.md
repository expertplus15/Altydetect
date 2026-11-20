# ADR-0014 — Veritas FR 0.5 : textes humains difficiles et corpus déposé

- **Statut** : accepté et exécuté (run 43901277788, 16/11/2026). FR 0.5 non retenu, voir « Résultats ».
- **Date** : 2026-11-15
- **Décideurs** : équipe AltyDetect

## Contexte

FR 0.4 (ADR-0012) franchit trois portes sur quatre. Il reste 1,9 % de faux positifs pour une porte de 1 %. Le seuil propre (ADR-0013) n'a pas suffi : aucun seuil entre 0,70 et 0,90 ne donne au plus 0,5 % de faux positifs sur la calibration (5 pour 932 textes humains au mieux, à 0,90).

| Textes humains classés « Probablement IA » | Jeux de test | Calibration |
| ------------------------------------------ | ------------ | ----------- |
| Pages universitaires                       | 5,5 %        | 5,2 %       |
| Pages web mC4                              | 1,3 %        | 1,4 %       |
| Wikipédia                                  | 2,3 %        | —           |
| Arrêts                                     | 0 %          | 1 %         |

Entre 0.3 et 0.4, des pages tirées au hasard ont réduit les erreurs (pages universitaires : 10 % → 5,5 %), mais l'effet faiblit.

Décisions du 15/11/2026 : AltyDetect reste un produit de détection et de plagiat ; Veritas, déployé une seule fois sur Modal, deviendra une API interne. L'utilisateur fournit un corpus déclaré libre de droits, écrit par des humains, aux dates mêlées (`incoming/corpus_ressources.jsonl.gz` dans le volume des corpus). Il demande qu'il soit inclus dans FR 0.5, avec un contrôle automatique.

## Décision proposée

**Ajouter au corpus 0.4 des textes humains que FR 0.4 classe à tort vers « IA » (« difficiles »), et autant de textes ordinaires, chacun avec un texte généré apparié.**

### Sources humaines (aucune réutilisée)

| Source                                         | Candidats notés | Retenus | Licence                                     | Date                           |
| ---------------------------------------------- | --------------- | ------- | ------------------------------------------- | ------------------------------ |
| French Science Commons, 12 fichiers jamais lus | ≤ 10 000        | 1 500   | comme en 0.3 (CC BY, CC BY-SA, CC0, Etalab) | ≤ 30/06/2022                   |
| mC4 français, fragment 2 (jamais utilisé)      | ≤ 5 000         | 800     | ODC-BY 1.0                                  | avril 2019                     |
| Corpus déposé (`corpus_ressources.jsonl.gz`)   | ≤ 6 000         | ≤ 700   | libre de droits (déclaration du déposant)   | daté et ≤ 30/06/2022 seulement |

- **Corpus déposé** :
  - seuls les textes **datés** d'avant le 30/06/2022 sont gardés, comme pour les autres sources : un texte plus récent a pu être écrit avec une IA, et il n'y a pas de date d'écriture vérifiable ;
  - date : un champ de date s'il existe, sinon l'année écrite dans le nom de la source (fichier « …_2010.pdf ») ; le fichier déposé n'a pas de champ de date (champs `text`, `source`, `page`, `extraction`) ;
  - langue française seulement ;
  - découpage en passages de 180 à 900 mots, au plus trois par texte, sans tableaux ni listes de chiffres ;
  - licence et source reprises du fichier quand il les donne.
- **Exclusions**, pour toutes les sources :
  - tout texte (empreinte) ou adresse déjà présent dans le corpus 0.4 ;
  - toute copie, même partielle, d'un jeu de test : 20 % de suites de 8 mots communes suffisent.

### Sélection

1. FR 0.4 note chaque candidat (probabilité « IA », sur un L4, sans entraînement).
2. Par source :
   - **au plus la moitié** des textes retenus sont « difficiles » (probabilité ≥ 0,5), tirés de façon stable ;
   - le reste est fait de candidats ordinaires.

   Cette limite évite que le modèle n'apprenne que des cas limites, ou des défauts de nettoyage propres à ces pages.

3. Partition entraînement ou calibration (1 sur 10). Aucun texte ajouté n'entre en partition test : les jeux `detection-v1`, `detection-v2` et `detection-v3` ne changent pas.

### Textes générés appariés

Un par texte humain, sur le même sujet et dans le même genre, comme en 0.3 et 0.4 (Qwen2.5-7B, Mistral-7B v0.3, Granite-3.3-8B ; Phi-3.5-mini tenu à l'écart). Deux consignes nouvelles, « page web » et « texte du même genre et du même registre » (corpus déposé), avec la typographie du texte humain apparié. Aucun appel à l'API Claude.

### Arrêts automatiques (avant toute dépense GPU de notation ou de génération)

Le run s'arrête :

- s'il y a moins de 1 500 candidats universitaires ou moins de 800 pages web ;
- s'il y a moins de 100 passages utilisables dans le corpus déposé (par exemple sans champ de date) ;
- si plus de 5 % des passages du corpus déposé recoupent un jeu de test.

Le rapport d'arrêt donne les comptes par motif, sans aucun texte.

### Entraînement, mesure et seuil

- Mêmes réglages qu'en 0.4.
- Mesure sur les trois jeux de test, avec les quatre portes inchangées (ADR-0011, ADR-0012).
- Dans le même run, le seuil propre selon la règle d'ADR-0013, inchangée : choix sur la calibration, puis mesure unique. Les rapports au seuil propre portent le suffixe `-seuil`.
- Si toutes les portes sont franchies, au seuil général ou au seuil propre : FR 0.5 remplace FR 0.1 en mode fantôme. Sinon : analyse par source, puis un nouvel ADR (encodeur plus grand, autres sources).

## Conséquences

- **Coût estimé** (tarifs Modal du 10/11/2026, L4 à 0,80 $/h ; débits mesurés en 0.4) :

  | Étape                        | Calcul                      | Coût                        |
  | ---------------------------- | --------------------------- | --------------------------- |
  | Candidats                    | CPU                         | ≈ 0,10 $                    |
  | Notation (≈ 15 000 à 21 000) | ≈ 20 à 25 min de L4         | ≈ 0,35 $                    |
  | Génération (≈ 3 000 textes)  | ≈ 5 h de L4, 8 en parallèle | ≈ 4 à 5 $                   |
  | Entraînement et mesure       | ≈ 40 min de L4              | ≈ 0,55 $                    |
  | Seuil propre                 | ≈ 3 min de L4               | ≈ 0,05 $                    |
  | **Total**                    | ≈ 3 h 30 de bout en bout    | **≈ 5 à 6 $, plafond 10 $** |

- **Manifestes** : `corpus-fr.json` du run, sans texte. La source et la licence de chaque passage du corpus déposé y figurent. Le fichier déposé reste dans le volume, jamais dans le dépôt.
- **Limite** : la licence du corpus déposé repose sur la déclaration du déposant. Aucun texte d'utilisateur de l'application n'y entre (`training_opt_in` non concerné).
- **Limite** : les textes difficiles sont choisis par FR 0.4. FR 0.5 peut donc garder d'autres angles morts, que FR 0.4 n'a pas vus. La vérification sur des textes réels reste nécessaire.

## Résultats (run 43901277788, 16/11/2026)

Détail : `docs/models/VRT-DET-FR-0.5.md`.

- **Arrêts automatiques** : aucun déclenché.
  - Candidats retenus : 8 847 universitaires, 5 000 pages web, 6 000 passages du corpus déposé.
  - Corpus déposé : 4 passages sur 86 863 recoupaient un jeu de test (moins de 0,01 %).
- **Corpus déposé** : sur 170 722 extraits, 113 141 gardés.
  - Écartés : 26 275 sans année dans le nom du fichier, 20 655 postérieurs à juin 2022, 10 651 non français.
  - Le 16/11/2026, le déposant déclare détenir des droits écrits pour cet usage.
- **Textes « difficiles » retenus** : 533 universitaires, 126 pages web, 62 du corpus déposé.
- **Durée et coût** : 4 h 47 de bout en bout. Le coût est estimé à 6 à 7 $ d'après les durées du journal (5,9 h de L4 pour la génération).
  - Une attente de 56 minutes sans journal précède la notation, entre la fin des candidats et le début de la notation. Elle est à expliquer avant le prochain run.
- **Mesure au seuil général (0,70)** : 1,28 % de faux positifs (23 textes humains sur 1 800), contre 1,9 % pour FR 0.4. Porte non franchie.
  - Pages universitaires : 5,5 % → 2,5 %.
  - Wikipédia : 2,3 % → 1,33 %.
  - Pages mC4 : 1,3 % → 1,1 %.
  - Textes courts : 3 %, inchangé.
  - Arrêts : 0 %.

  Rappel : Claude 100 %, générateurs vus 99,5 %, Phi 100 %.

- **Seuil propre** : aucun sur la grille.
  - À 0,90 : 8 faux positifs sur 1 236 textes humains de calibration (0,65 %), pour une cible de 0,5 %.
  - Les pages universitaires font 31 des 44 faux positifs de calibration à 0,70.
- **Conséquence** : VRT-DET-FR-0.1 reste en mode fantôme. La suite (encodeur plus grand ou autres sources universitaires) fera l'objet d'un nouvel ADR, avec une estimation de coût.
