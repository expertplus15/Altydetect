# ADR-0010 — Activation de Veritas 0.1 en mode fantôme

- **Statut** : proposé
- **Date** : 2026-11-11
- **Décideurs** : équipe AltyDetect

## Contexte

VRT-DET-FR-0.1 et VRT-DET-EN-0.1 sont livrés (`services/veritas/models`, fiches dans
`docs/models/`). La phase 3 exige de les faire tourner en arrière-plan du fournisseur externe
pour mesurer l'accord (porte : ≥ 85 % sur un segment). Trois points bloquaient l'activation :

1. **Repli de l'aiguillage** : quand aucun fournisseur externe ne répondait, Veritas répondait
   seul aux utilisateurs. Sans contrat de fournisseur (ADR-0001), activer les modèles aurait
   donc mis Veritas 0.1 en production, avant toute mesure d'accord.
2. **Coût** : chaque comparaison appelle la couche 2 sur un GPU L4 Modal. Avec un trafic
   faible, presque chaque appel paie un démarrage à froid et la minute de maintien.
   Estimation du 10/11/2026 avec toutes les requêtes comparées : ≈ 58, 300 et 600 $ par mois
   pour 50, 500 et 5 000 détections par jour.
3. **Livraison** : les paquets n'étaient pas dans l'image Docker du service.

## Décision

- Nouveau réglage `veritas_fallback` dans `routing.yaml`, **désactivé** : si aucun fournisseur
  externe ne répond, la détection est indisponible (`DETECTION_UNAVAILABLE`), y compris en mode
  approfondi, sans appel GPU. Seul un segment promu (`serve: veritas`) laisse Veritas répondre.
- Mode fantôme sur **10 %** des requêtes (`shadow.sample_rate: 0.1`), relevé quand le coût réel
  est connu. Ordre de grandeur : ≈ 6, 58 et 300 $ par mois pour 50, 500 et 5 000 détections
  par jour, plus un appel par détection approfondie (offre Pro).
- Les paquets sont copiés dans l'image (`/app/services/veritas/models`) ; ils ne sont chargés
  que si `VERITAS_MODEL_DIR` est défini. L'activation se fait par configuration, sans
  nouvelle version du code.
- Ordre d'activation (`docs/deploiement.md`, section 7) : déployer la couche 2 sur Modal
  (étape `deploy` du workflow), puis définir `VERITAS_MODEL_DIR` et les jetons Modal sur
  `veritas-api` et `veritas-shadow`, puis démarrer `veritas-shadow`. Prérequis : un
  fournisseur externe actif, sans quoi rien n'est comparé.

## Conséquences

- Aucun utilisateur ne reçoit de résultat de Veritas seul avant le franchissement de la porte ;
  une panne du fournisseur externe rend Détecter indisponible, comme aujourd'hui.
- Avec 10 %, l'échantillon de `min_comparisons` (200, encore TODO) se remplit dix fois moins
  vite : ≈ 40 jours par segment à 50 détections par jour, 4 jours à 500.
- Mode approfondi : l'appel à la couche 2 est synchrone. Un démarrage à froid (≈ 20 à 40 s)
  s'ajoute au temps de réponse ; le client web attend 60 s, et un échec de Veritas laisse
  l'externe répondre seul. À mesurer dès l'activation.
- À revoir : le taux d'échantillonnage après un mois de facturation Modal ; l'inférence de la
  couche 2 par lots horaires si le coût par comparaison reste élevé.
