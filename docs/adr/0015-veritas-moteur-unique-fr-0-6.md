# ADR-0015 — Veritas, seul moteur de détection, et VRT-DET-FR-0.6 (encodeur plus grand)

- **Statut** : proposé
- **Date** : 2026-11-16
- **Décideurs** : équipe AltyDetect (décision « Veritas seul » du 16/11/2026)
- **Remplace en partie** : ADR-0001 (fournisseur externe principal), ADR-0010 (mode fantôme, porte d'accord)

## Contexte

**Ce qui était prévu.** L'architecture (CLAUDE.md §4.3 et §4.4, ADR-0001, ADR-0008, ADR-0010) mettait un fournisseur externe en production : Pangram en principal, Copyleaks en secours. Veritas tournait en arrière-plan jusqu'à une porte d'accord avec ce fournisseur (phase 3).

**Ce qui se passe en production aujourd'hui.** Aucun contrat de fournisseur n'est signé. Détecter répond donc `DETECTION_UNAVAILABLE` (`docs/deploiement.md`, §8).

**La décision du 16/11/2026.** Veritas sera le seul moteur de détection, sans fournisseur externe.

**Où en sont les modèles :**

| Langue   | Modèle         | Faux positifs (jeux de test) | Portes                                | État                                                           |
| -------- | -------------- | ---------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| Anglais  | VRT-DET-EN-0.2 | 0,2 % (detection-v1)         | toutes franchies (ADR-0011)           | livré (`services/veritas/models/en`), jamais servi             |
| Français | VRT-DET-FR-0.1 | 0,4 % (detection-v1)         | rappel faible sur les modèles ouverts | livré, jamais servi                                            |
| Français | VRT-DET-FR-0.5 | 1,28 % (v1, v2, v3)          | faux positifs non franchie            | non retenu ; aucun seuil propre (0,65 % en calibration à 0,90) |

**Ce que change « Veritas seul ».** Sans second avis, chaque erreur de Veritas arrive chez un client. Accuser à tort un texte humain est l'erreur la plus grave : un étudiant, un candidat, un rédacteur. La porte des faux positifs (1 %) a été fixée pour un moteur en arrière-plan. Elle ne suffit plus.

**Pourquoi un encodeur plus grand.** De FR 0.2 à FR 0.5, chaque ajout de textes humains a réduit les erreurs qu'il visait, avec un effet de plus en plus faible (3,7 % → 2,8 % → 1,9 % → 1,28 %). Les erreurs restantes sont surtout des pages universitaires : 31 des 44 faux positifs de calibration de FR 0.5. Leur registre soutenu ressemble à celui des textes générés. Un encodeur plus grand distingue mieux ces nuances. On peut le tester sur le corpus 0.5 existant, sans nouvelle génération de textes, alors que la génération était l'étape la plus coûteuse de 0.5.

## Décision

### 1. Veritas est le seul moteur de détection

- **Aiguillage** : le segment d'une langue **ouverte** (§2) passe à `serve: veritas` avec `veritas_min_confidence: low`. Veritas y répond seul, quel que soit son niveau de confiance. Le résultat reste une probabilité avec ses trois bandes, et un texte peu net va en « Indéterminé », jamais en verdict.
- **Langue non ouverte** : son segment reste `serve: external`. Sans fournisseur configuré, il répond `DETECTION_UNAVAILABLE`.
- **`veritas_fallback` reste `false`.** Sinon, FR 0.1, toujours dans l'image, répondrait aux textes français avant l'ouverture du français.
- **Mode approfondi** : petite modification de l'aiguillage, avec ses tests. Quand aucun fournisseur externe n'est configuré, le mode approfondi suit le segment au lieu de demander deux avis. Une langue ouverte y est donc servie par Veritas, une langue fermée reste indisponible.
- **Mode fantôme** : `shadow.enabled: false`. Sans fournisseur, il n'y a plus rien à comparer.
- **Fournisseurs externes** : aucun n'est configuré en production (`DETECTION_PROVIDER` vide).
  - L'interface `DetectionProvider` et ses implémentations restent dans le code, testées, sans être utilisées. Elles servent à mesurer, ponctuellement et avec accord explicite, un fournisseur sur nos jeux de test.
  - L'aiguillage garde ses quatre cas et leurs tests.
- **Langues** : français et anglais seulement. Un texte dans une autre langue, ou dans une langue dont aucun modèle n'est ouvert, reçoit `DETECTION_UNAVAILABLE`, comme aujourd'hui. Le contrat de détection ne change pas.

### 2. Critère pour qu'un modèle réponde seul

Un modèle Veritas ne sert une langue que si les deux conditions suivantes sont remplies.

1. **Un seuil propre existe** selon la règle d'ADR-0013, inchangée :
   - c'est le plus petit seuil de la grille 0,70 à 0,90 qui donne au plus 0,5 % de faux positifs sur la partition de calibration ;
   - il est inscrit dans la section `models` de `thresholds.yaml`.
2. **Les quatre portes sont franchies avec ce seuil**, mesurées une seule fois sur `detection-v1`, `detection-v2` et `detection-v3` :
   - faux positifs ≤ 1 % ;
   - rappel ≥ 95 % sur Claude ;
   - rappel ≥ 80 % sur les générateurs vus ;
   - rappel ≥ 60 % sur le générateur jamais vu.

La porte d'accord avec un fournisseur externe (phase 3, `routing.yaml` → `agreement`) n'a plus d'objet. Elle est remplacée par une vérification sur des textes réels avant l'ouverture de chaque langue. Son protocole sera fixé dans l'ADR d'ouverture : nombre de textes, provenance, consentement, sans stockage de texte (CLAUDE.md §4.5).

**Anglais** : EN 0.2 n'a jamais eu de choix de seuil propre. Le stage `threshold` lui est appliqué dans le même run que FR 0.6 (≈ 3 min de L4), avec la même règle.

**Français** : ni FR 0.1 (rappel faible) ni FR 0.5 (aucun seuil propre) ne remplit le critère. Le français reste indisponible jusqu'à un modèle qui le remplit.

### 3. VRT-DET-FR-0.6 : même corpus, encodeur plus grand

- **Corpus** : le corpus 0.5, recopié à l'identique (manifeste `ml/corpus/manifests/veritas-0.5/fr.jsonl`). Aucune nouvelle source, aucune génération, aucun appel à l'API Claude.
- **Couche 2** : `almanach/camembert-large` (≈ 335 M de paramètres, licence MIT) au lieu de `almanach/camembert-base` (≈ 110 M).
  - Taux d'apprentissage 1e-5 au lieu de 2e-5 : un encodeur large est moins stable avec un taux élevé.
  - Réglages inchangés : 2 époques, lissage des étiquettes 0,1, classes équilibrées, lots de 16.
  - Si la mémoire du L4 ne suffit pas, on passe à des lots de 8 avec accumulation sur 2 pas. L'effet est le même, rien d'autre ne change.
- **Couches 1 et 3** : inchangées.
- **Dans le même run** :
  1. entraînement ;
  2. mesure sur les trois jeux de test, au seuil général ;
  3. choix du seuil propre sur la calibration (ADR-0013) ;
  4. si un seuil est retenu, mesure unique avec ce seuil (rapports `-seuil`) ;
  5. stage `threshold` sur EN 0.2.
- **Run** : nouvelle version `v6` du workflow `veritas-train` (stage `all`, `languages: fr`).
- **Prérequis**, dans la même PR de code que `v6` : le lancement manuel du workflow n'a plus de valeurs par défaut coûteuses.
  - Plus d'étape `all`, de run `pilot` ni de génération Claude par défaut.
  - Une confirmation du coût est obligatoire.
  - Cela évite une répétition du lancement accidentel du 16/11/2026 (≈ 27 $ d'API Claude).

### 4. Issues

- **FR 0.6 remplit le critère (§2)** :
  - il est livré dans `services/veritas/models/fr` avec son seuil propre ;
  - le français s'ouvre après la vérification sur des textes réels.
- **FR 0.6 ne le remplit pas** : le français reste indisponible. La suite viendra dans un nouvel ADR, au choix :
  - d'autres sources universitaires (thèses et articles sous licence ouverte, HAL CC BY, étape 2 de la feuille de route) ;
  - un encodeur multilingue plus grand ;
  - une bande « Indéterminé » plus large pour le français.

  Aucun nouvel essai de seuil sur les mêmes jeux de test.

- **EN 0.2 remplit le critère** : l'anglais s'ouvre après la vérification sur des textes réels. **Sinon** : l'anglais reste indisponible, et un ADR propose la suite.

## Conséquences

**Coût de l'entraînement FR 0.6**

Estimation sur les tarifs Modal du 10/11/2026 (L4 à 0,80 $/h) et les durées mesurées en 0.5 (encodeur base : 33 min pour 8 210 pas). Un encodeur large fait environ trois fois plus de calcul.

| Étape                                          | Calcul                   | Coût                       |
| ---------------------------------------------- | ------------------------ | -------------------------- |
| Recopie du corpus 0.5                          | CPU, quelques minutes    | < 0,05 $                   |
| Entraînement (couches 1 à 3)                   | ≈ 1 h 40 à 2 h de L4     | ≈ 1,30 à 1,60 $            |
| Mesure sur les trois jeux de test              | ≈ 10 min de L4           | ≈ 0,15 $                   |
| Seuil propre et mesure `-seuil` (FR), seuil EN | ≈ 15 min de L4           | ≈ 0,20 $                   |
| **Total**                                      | ≈ 2 h 30 de bout en bout | **≈ 2 à 3 $, plafond 5 $** |

**Coût de Veritas en production, désormais pour tout le trafic**

- L'ADR-0010 estimait, avec toutes les requêtes servies par la couche 2 sur un L4 Modal à la demande : ≈ 58, 300 et 600 $ par mois pour 50, 500 et 5 000 détections par jour. Le démarrage à froid et la minute de maintien y pèsent plus que le calcul.
- Un encodeur large ajoute environ 0,1 s de calcul par document. L'ordre de grandeur reste le même, à remesurer à l'ouverture.
- Il n'y a plus de coût de fournisseur par mot.
- Pas de GPU permanent (CLAUDE.md §10) : le service garde la mise à l'échelle jusqu'à zéro.

**Latence** : le premier appel après une période creuse paie le démarrage à froid du conteneur GPU, de quelques secondes à quelques dizaines de secondes. C'est acceptable pour une première version ; à mesurer et à revoir à l'ouverture.

**Documents à mettre à jour après l'acceptation de cet ADR** (PR séparées, une intention chacune) :

- `CLAUDE.md` :
  - §1 : Veritas seul moteur ;
  - §2 : ligne « Inférence GPU » inchangée ;
  - §4.3 et §4.4 : fournisseurs gardés pour la mesure seulement, aiguillage réglé sur Veritas ;
  - §11 : porte de la phase 3 remplacée par le critère du §2.
- ADR-0001 et ADR-0010 : marqués « remplacé en partie par ADR-0015 ».
- `routing.yaml` et `docs/deploiement.md` : nouveaux réglages, `veritas-shadow` inutile.

**Risques**

- **Sans second avis, une dérive du modèle passe inaperçue**, par exemple sur un nouveau générateur ou un nouveau type de texte. À prévoir :
  - une mesure périodique sur des jeux de test renouvelés ;
  - une mesure ponctuelle d'un fournisseur sur ces jeux, avec accord explicite et coût annoncé.
- **Le français peut rester indisponible plusieurs semaines** si FR 0.6 ne suffit pas.
- **Veritas est vendu seul.** Ses fiches modèles et le benchmark public de la phase 4 deviennent la seule garantie de qualité présentée aux clients.

**À revoir** : à l'ouverture de chaque langue (coût réel, latence, vérification sur textes réels), puis à chaque nouveau modèle.
