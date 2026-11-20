# ADR-0018 — Ouverture du français : vérification de VRT-DET-FR-0.6 sur des textes réels

- **Statut** : accepté (20/11/2026). Protocole, portes et tailles repris d'ADR-0016, validés pour l'anglais le 19/11/2026 ; seules les sources changent. Mise en œuvre : `ml/eval/testset/verification-fr-v1/README.md`.
- **Date** : 2026-11-20
- **Décideurs** : équipe AltyDetect
- **Suite de** : ADR-0017 (FR 0.6 au seuil de 0,93, quatre portes franchies), ADR-0016 (protocole pour l'anglais), ADR-0015 (critère d'ouverture)

## Contexte

**Où en est le français.** VRT-DET-FR-0.6 remplit le critère d'ADR-0015 §2 (ADR-0017, run 44643189844) :

- seuil propre 0,93, choisi sur la calibration (0,40 % de faux positifs) et inscrit dans `thresholds.yaml` ;
- mesure unique sur `detection-v4` : faux positifs 0,45 % (5 sur 1 100), rappel 99,5 % sur Claude, 98,75 % sur les générateurs vus, 100 % sur Phi-3.5-mini ;
- paquet livré dans `services/veritas/models/fr`.

ADR-0015 demande en plus une vérification sur des textes réels avant d'ouvrir une langue. ADR-0016 l'a fixée pour l'anglais ; cet ADR l'applique au français.

**Pourquoi cette vérification.** `detection-v4` est construit comme le corpus : pages web, Wikipédia, pages universitaires, arrêts, mêmes consignes de génération. Il ne dit rien :

- des genres absents du corpus : copies d'étudiants, lettres, courriels, rapports, messages de forum ;
- du **français écrit par des non-natifs**, plus simple et plus régulier ;
- des assistants commerciaux (ChatGPT, Gemini, Copilot, Le Chat) ;
- des textes générés puis retouchés à la main.

Le seuil de 0,93 est proche du plafond des probabilités (≈ 0,96, ADR-0017) : un texte humain très régulier noté au-dessus serait un faux positif sans second avis. La vérification porte donc d'abord sur les textes humains.

**Ce qui est déjà en place** : `serve: closed` et l'erreur `UNSUPPORTED_LANGUAGE`, le mode approfondi qui suit le segment sans fournisseur, le message de l'éditeur (étapes 1 et 2 d'ADR-0016 §4).

## Décision

### 1. Jeu de vérification `verification-fr-v1`

Un jeu nouveau, jamais utilisé, mesuré **une seule fois**. Il ne sert ni à l'entraînement ni au choix d'un seuil.

**Textes humains (au moins 600)** : sources jamais utilisées, datées d'avant le 30/11/2022 (sortie de ChatGPT), sous une licence qui permet un usage commercial.

| Catégorie             | Source                                                                                               | Textes | Licence                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Forum                 | French Language Stack Exchange : questions et réponses rédigées en français (beaucoup de non-natifs) | 150    | CC BY-SA (vidage Stack Exchange)                               |
| Résumés scientifiques | Résumés en français d'articles et de thèses déposés sur HAL                                          | 350    | CC BY, CC BY-SA ou CC0 (licence de chaque dépôt, lue dans HAL) |
| Textes de volontaires | Textes français écrits avant 2022 par des personnes qui y consentent (§2), non-natifs bienvenus      | ≥ 100  | consentement écrit                                             |

- Longueur : 150 à 1 500 mots ; code, citations et tableaux retirés ; langue vérifiée (français).
- Exclusions : tout texte (empreinte), adresse ou copie partielle (20 % de suites de 8 mots) du corpus de FR 0.6 et de `detection-v1` à `detection-v4`.
- Si le forum donne moins de 150 textes, les résumés complètent jusqu'à 500 textes publics. Le forum est alors publié sans porte propre s'il a moins de 100 textes.
- La licence est lue document par document (comme arXiv pour l'anglais) : la licence générale de l'interface HAL n'a pas pu être vérifiée depuis l'environnement de développement. Seuls CC BY, CC BY-SA et CC0 sont gardés.

**Textes générés (au moins 100)** : déposés par l'équipe, produits à la main dans les interfaces web de ChatGPT, Gemini, Copilot et Le Chat, sur des consignes de même genre que les textes humains (dissertation, lettre, courriel, rapport, réponse à une question). Aucun appel d'API, aucune dépendance nouvelle.

**Textes retouchés (facultatif)** : textes générés puis retouchés à la main. Mesurés et publiés, sans porte.

### 2. Volontaires : consentement et absence de stockage

Identique à ADR-0016 §2 :

- consentement écrit (mesure unique, jamais l'entraînement ; effacement juste après la mesure ; texte écrit par la personne, sans outil de génération, avant 2022) ;
- dépôt dans le volume Modal `altydetect-veritas-corpus`, dossier `incoming/verification-fr-v1/`, jamais dans le dépôt ni dans l'application ;
- textes des volontaires effacés à la fin du run ; rapports sans aucun texte.

### 3. Portes (au seuil propre de 0,93)

| Porte                                                  | Valeur |
| ------------------------------------------------------ | ------ |
| Faux positifs, tous les textes humains                 | ≤ 1 %  |
| Faux positifs, chaque catégorie humaine (≥ 100 textes) | ≤ 2 %  |
| Rappel sur les assistants commerciaux                  | ≥ 60 % |

- Une seule mesure : pas de nouveau seuil, pas de nouvel essai sur ce jeu.
- Moins de 600 textes humains ou de 100 textes d'assistants : arrêt avant toute dépense GPU.
- Le rapport donne la borne haute à 95 % du taux de faux positifs (avec 600 textes : 0,5 % pour 0 erreur, 1,05 % pour 2).
- **Portes franchies** : le français s'ouvre (§4). **Non franchies** : il reste fermé ; analyse par catégorie et nouvel ADR (piste B d'ADR-0017 : sources universitaires HAL et nouveau modèle).

### 4. Ouverture, si les portes sont franchies

1. **`routing.yaml`** : `fr` → `serve: veritas`, `veritas_min_confidence: low`. L'anglais garde l'état que lui donne ADR-0016 (fermé tant que sa vérification n'est pas faite) ; `default` → `serve: closed`.
2. **Mise en production** (`docs/deploiement.md` §7) : couche 2 déployée (étape `deploy`), `VERITAS_MODEL_DIR`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` sur `veritas-api`.
3. **Pages publiques et Tarifs** : la détection couvre le français (et l'anglais s'il est ouvert).
4. **Suivi** : celui d'ADR-0016 §5, pour le français (bandes, confiance, latence, démarrages à froid ; alerte si la part « Probablement IA » double d'une semaine à l'autre).

**Retour arrière** : `fr` → `serve: closed`, relu à chaud.

## Conséquences

**Coût de la vérification** (tarifs Modal du 10/11/2026, L4 à 0,80 $/h)

| Étape                                               | Calcul                          | Coût                   |
| --------------------------------------------------- | ------------------------------- | ---------------------- |
| Téléchargement et préparation (Stack Exchange, HAL) | CPU, ≈ 10 à 20 min              | ≈ 0,05 à 0,20 $        |
| Notation d'environ 800 textes par FR 0.6            | ≈ 10 min de L4 (encodeur large) | ≈ 0,15 à 0,25 $        |
| **Total**                                           |                                 | **< 1 $, plafond 2 $** |

**Coût en production** : seuls les textes des langues ouvertes appellent le GPU. FR 0.6 met environ 180 ms par document sur un L4 chaud (trois fois FR 0.5) ; l'ordre de grandeur d'ADR-0010 reste valable (≈ 58 à 600 $ par mois de 50 à 5 000 détections par jour), surtout dû aux démarrages à froid. Pas de GPU permanent.

**Ce qui devient possible** : la détection en français, langue principale des clients, avec un moteur maison et sans coût par mot.

**Risques**

- **Peu de volontaires** : le run s'arrête avant le GPU sous 600 textes humains ; compléter le dépôt.
- **Forum français trop petit** : French Language Stack Exchange compte beaucoup de messages en anglais. Les résumés HAL complètent (§1), au prix d'une part universitaire plus forte, qui est aussi la catégorie la plus difficile pour FR 0.6.
- **Textes de volontaires mal datés** : limite déclarée par le consentement, mentionnée dans le rapport.
- **Biais de sélection** : ni forum ni résumés ne représentent les copies d'étudiants ; les volontaires en couvrent une partie.

**À revoir** : après un mois d'ouverture, puis à chaque nouveau modèle français.
