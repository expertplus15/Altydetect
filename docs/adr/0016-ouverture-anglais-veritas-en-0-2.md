# ADR-0016 — Ouverture de l'anglais : vérification de VRT-DET-EN-0.2 sur des textes réels

- **Statut** : accepté (19/11/2026). Portes, tailles et sources validées telles quelles. Mise en œuvre : `ml/eval/testset/verification-en-v1/README.md`.
- **Date** : 2026-11-19
- **Décideurs** : équipe AltyDetect
- **Suite de** : ADR-0015 (Veritas seul moteur, critère d'ouverture d'une langue)

## Contexte

**Où en est l'anglais.** VRT-DET-EN-0.2 remplit le critère d'ADR-0015 §2 (run 44352541251, 18/11/2026) :

- seuil propre 0,70, choisi sur la calibration (0,45 % de faux positifs) et inscrit dans `thresholds.yaml` ;
- à ce seuil, faux positifs 0,14 % sur 1 400 textes humains, rappel 100 % sur Claude, sur les générateurs vus et sur Phi-3.5-mini.

ADR-0015 demande en plus une **vérification sur des textes réels** avant d'ouvrir une langue, dont le protocole est fixé ici.

**Pourquoi cette vérification.** Les jeux de test sont produits comme le corpus : mêmes sources (pages web, Wikipédia), mêmes consignes, même nettoyage. Le 100 % de rappel et le 0,14 % de faux positifs ne disent rien des textes que les clients enverront. La fiche d'EN 0.2 (« Limites à connaître ») cite ce qui n'a jamais été mesuré :

- des genres absents du corpus : essais d'étudiants, lettres, courriels, rapports, questions sur un forum ;
- **l'anglais écrit par des non-natifs**. C'est le risque principal pour AltyDetect : une grande part des clients sont francophones et soumettront leur propre anglais. Une écriture plus simple et plus régulière ressemble à celle d'un texte généré, et c'est un défaut connu des détecteurs ;
- les assistants commerciaux autres que Claude (ChatGPT, Gemini, Copilot) ;
- les textes générés puis retouchés à la main.

**Sans second avis** (ADR-0015), chaque faux positif arrive chez un client. La vérification porte donc d'abord sur les textes humains.

**Ce qui manque en production** pour qu'une langue s'ouvre et l'autre non :

- le mode approfondi demande toujours deux avis et répond donc « indisponible » sans fournisseur ;
- un texte français reçoit `DETECTION_UNAVAILABLE`, avec le message « Le service de détection ne répond pas… réessayez dans un instant ». Ce message est faux pour une langue fermée : réessayer ne changera rien.

## Décision

### 1. Jeu de vérification `verification-en-v1`

Un jeu nouveau, jamais utilisé, mesuré **une seule fois**. Il ne sert ni à l'entraînement ni au choix d'un seuil.

**Textes humains (au moins 600)** : sources jamais utilisées, datées d'avant le 30/11/2022 (sortie de ChatGPT), sous une licence qui permet un usage commercial.

| Catégorie                   | Source proposée                                                          | Textes | Licence                                            |
| --------------------------- | ------------------------------------------------------------------------ | ------ | -------------------------------------------------- |
| Anglais non natif, forum    | English Language Learners Stack Exchange (questions et réponses)         | 150    | CC BY-SA (vidage Stack Exchange)                   |
| Forum, questions techniques | Autres sites Stack Exchange, hors code (Academia, Workplace, Writing…)   | 150    | CC BY-SA                                           |
| Résumés scientifiques       | Résumés arXiv, auteurs du monde entier, beaucoup de non-natifs           | 200    | CC BY, CC BY-SA ou CC0 (licence de chaque article) |
| Textes de volontaires       | Textes anglais écrits avant 2022 par des personnes qui y consentent (§2) | ≥ 100  | consentement écrit                                 |

- Longueur : au moins 150 mots (en dessous, aucun score n'est rendu) ; blocs de code, citations et listes retirés.
- Exclusions : tout texte (empreinte), adresse ou suite de 8 mots partagée à plus de 20 % avec le corpus d'EN 0.2, `detection-v1` ou `detection-v2`.
- La licence de chaque source est vérifiée dans la PR de code, avant tout téléchargement. arXiv : la licence est lue article par article, et seuls CC BY, CC BY-SA et CC0 sont gardés (la licence des métadonnées n'a pas pu être vérifiée depuis l'environnement de développement). Une source qui ne convient pas est remplacée par une source de même genre, signalée dans la PR.

**Textes générés (au moins 100)** : déposés par l'équipe, produits à la main dans les interfaces web des assistants commerciaux (ChatGPT, Gemini, Copilot), sur des consignes de même genre que les textes humains (essai, lettre, courriel, réponse à une question). Aucun appel d'API nouveau, aucune dépendance nouvelle.

**Textes retouchés (facultatif)** : des textes générés puis retouchés à la main par les volontaires. Mesurés et publiés, sans porte.

### 2. Textes de volontaires : consentement et absence de stockage

- **Consentement écrit**, recueilli par l'équipe, qui couvre :
  - l'usage : une mesure unique de Veritas, jamais l'entraînement ;
  - l'effacement des textes juste après la mesure ;
  - l'assurance que le texte a été écrit par la personne, sans outil de génération, avant 2022.
- **Dépôt** : dans le volume Modal `altydetect-veritas-corpus`, dossier `incoming/verification-en-v1/`, jamais dans le dépôt, jamais dans l'application (aucun texte d'utilisateur de l'application, CLAUDE.md §6).
- **Effacement** : à la fin du run, les textes des volontaires sont supprimés du volume. Seuls restent l'empreinte, la catégorie, la longueur et la probabilité. Les textes publics restent dans le volume, comme les autres jeux de test.
- Le rapport ne contient aucun texte, ni pour les volontaires ni pour les sources publiques.

### 3. Portes de la vérification (au seuil propre de 0,70)

| Porte                                                               | Valeur proposée |
| ------------------------------------------------------------------- | --------------- |
| Faux positifs, tous les textes humains                              | ≤ 1 %           |
| Faux positifs, chaque catégorie humaine (anglais non natif compris) | ≤ 2 %           |
| Rappel sur les assistants commerciaux (tous confondus)              | ≥ 60 %          |

- Le rappel est fixé comme la porte du générateur jamais vu : un assistant manqué est un défaut, mais moins grave qu'un faux positif.
- Les textes retouchés et la part « Indéterminé » sont publiés sans porte.
- **Limite statistique** : avec 600 textes humains, 6 faux positifs donnent 1 %. Seul un résultat de 0 ou 1 erreur garantit, avec une confiance de 95 %, un taux réel inférieur à 1 % (borne haute : 0,5 % et 0,79 % ; 1,05 % pour 2 erreurs). Entre 2 et 6 erreurs, la porte est franchie de justesse : le rapport donnera l'intervalle de confiance.
- **Une seule mesure.** Pas de nouveau seuil, pas de nouvel essai sur ce jeu.
  - Portes franchies : l'anglais s'ouvre (§4).
  - Portes non franchies : l'anglais reste fermé ; analyse par catégorie et nouvel ADR (corpus non natif, seuil plus haut sur un nouveau jeu de calibration, bande « Indéterminé » plus large).

### 4. Ouverture, si les portes sont franchies

Dans cet ordre, une PR par intention :

1. **Aiguillage** (code et tests) :
   - nouvelle valeur `serve: closed` : la langue n'est pas servie, la réponse est l'erreur `UNSUPPORTED_LANGUAGE` (422), déjà prévue par le contrat de détection et jamais utilisée. Aucun changement de contrat ;
   - le mode approfondi suit le segment quand aucun fournisseur externe n'est configuré (ADR-0015 §1) ;
   - les quatre cas de l'aiguillage restent testés (CLAUDE.md §9).
2. **Interface** : message pour `UNSUPPORTED_LANGUAGE` dans `messages/fr.json` et `en.json`, par exemple : « La détection n'est pas encore disponible pour la langue de ce texte. Elle l'est pour l'anglais. Vos mots ont été rendus. » Les mots du quota sont rendus comme pour `DETECTION_UNAVAILABLE`.
3. **`routing.yaml`** : `en` → `serve: veritas`, `veritas_min_confidence: low` ; `fr` et `default` → `serve: closed` ; `shadow.enabled: false`.
4. **Mise en production** (`docs/deploiement.md`, §7 réécrit) :
   - déployer la couche 2 sur Modal (étape `deploy` du workflow, avec confirmation du coût) ; aucun coût tant qu'elle n'est pas appelée ;
   - définir `VERITAS_MODEL_DIR`, `MODAL_TOKEN_ID` et `MODAL_TOKEN_SECRET` sur `veritas-api` ;
   - le worker `veritas-shadow` n'est pas démarré.
5. **Documents** : mises à jour prévues par ADR-0015 (CLAUDE.md §1, §4.3, §4.4, §11 ; ADR-0001 et ADR-0010 « remplacés en partie »). Les pages publiques et la page Tarifs disent que la détection couvre l'anglais, le français étant annoncé « bientôt », sans date.

**Retour arrière** : `en` → `serve: closed` dans `routing.yaml`, relu à chaud, sans redéploiement.

### 5. Suivi après l'ouverture

Sans second avis, une dérive passerait inaperçue. Les résultats agrégés sont déjà enregistrés (table `analyses`, sans texte) ; le suivi en tire, sans aucun texte :

- par jour : nombre de détections anglaises, répartition des trois bandes et des niveaux de confiance, latence, démarrages à froid ;
- revue hebdomadaire le premier mois. Une hausse nette de la part « Probablement IA » (par exemple, du simple au double d'une semaine à l'autre) déclenche une revue et, au besoin, le retour arrière.

Le coût réel de Modal est relevé au bout d'un mois et comparé à l'estimation d'ADR-0010.

## Conséquences

**Coût de la vérification** (tarifs Modal du 10/11/2026, L4 à 0,80 $/h)

| Étape                                                 | Calcul             | Coût                   |
| ----------------------------------------------------- | ------------------ | ---------------------- |
| Téléchargement et préparation (Stack Exchange, arXiv) | CPU, ≈ 20 à 30 min | ≈ 0,10 à 0,30 $        |
| Notation d'environ 800 textes par EN 0.2              | ≈ 5 à 10 min de L4 | ≈ 0,15 $               |
| **Total**                                             |                    | **< 1 $, plafond 2 $** |

**Coût en production** : seuls les textes anglais appellent le GPU. Ordre de grandeur d'ADR-0010 pour toutes les requêtes servies par la couche 2 : ≈ 58, 300 et 600 $ par mois pour 50, 500 et 5 000 détections par jour, surtout dû aux démarrages à froid et à la minute de maintien. Pas de GPU permanent.

**Ce qui devient possible** : Détecter sert ses premiers résultats, en anglais, avec un moteur maison et sans coût par mot.

**Ce qui devient plus difficile**

- Un produit francophone dont la détection ne couvre d'abord que l'anglais : l'interface doit le dire clairement, dès l'éditeur.
- La qualité repose sur un seul moteur ; le suivi du §5 et les fiches modèles sont la seule garantie.

**Risques**

- **Peu de volontaires** : sans 600 textes humains au total, le run s'arrête avant toute dépense GPU. Il faut alors compléter le dépôt, ou modifier cet ADR. Une catégorie de moins de 100 textes reste mesurée, sans porte propre (trop peu de textes pour conclure).
- **Textes de volontaires mal datés** : un texte retouché avec un outil de génération serait compté comme humain. Le consentement le fait déclarer ; c'est une limite, mentionnée dans le rapport.
- **Biais de sélection** : Stack Exchange et arXiv ne représentent pas les essais d'étudiants ni les lettres de motivation. Les volontaires comblent une partie de l'écart.

**À revoir** : après un mois d'ouverture (coût réel, latence, répartition des bandes), puis à chaque nouveau modèle anglais.

## Valeurs validées (19/11/2026)

- Tailles : 600 textes humains au moins, dont 100 de volontaires ; 100 textes d'assistants commerciaux.
- Portes : faux positifs ≤ 1 % au total et ≤ 2 % par catégorie ; rappel ≥ 60 % sur les assistants commerciaux.
- Sources : Stack Exchange, arXiv, volontaires.
- Seuil d'alerte du suivi : part « Probablement IA » doublée d'une semaine à l'autre.
