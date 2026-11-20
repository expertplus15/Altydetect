# Mise en production

Ce guide couvre les phases 1 à 3. Il mène d'abord à la porte de sortie de la phase 1 : un
abonnement Pro souscrit, utilisé pour réécrire, exporté en PDF et résilié, en production, en
français et en anglais. La section 8 donne la recette concrète Vercel + Neon + Upstash + Railway.

## Architecture

| Composant                          | Rôle                                                      | Hébergement recommandé                                     |
| ---------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web` (Next.js)               | Site, espace de travail, routes internes, webhooks Stripe | Vercel                                                     |
| Worker (`pnpm -C apps/web worker`) | Exports PDF, rétention quotidienne de l'historique        | Railway ou Render (service toujours actif)                 |
| PostgreSQL 16 + pgvector           | Données                                                   | Railway, Render, Neon ou Supabase                          |
| Redis 7                            | Files BullMQ, essais sans compte, PDF temporaires         | Railway, Render ou Upstash (connexion TCP, pas l'API REST) |
| Indexa (API + worker RQ)           | Plagiat                                                   | Railway (image Docker)                                     |
| Veritas (API + worker RQ)          | Détection                                                 | Railway (image Docker), couche 2 sur Modal                 |

Le web, le worker, Indexa et Veritas utilisent la **même** base et le **même** Redis.

## 1. Comptes et clés

| Service       | À faire                                                                                                      | Variables                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Domaine       | Pointer `altydetect.com` vers Vercel                                                                         | `NEXT_PUBLIC_APP_URL=https://altydetect.com`, `AUTH_URL` (même valeur)         |
| Auth.js       | Générer un secret : `openssl rand -base64 32`                                                                | `AUTH_SECRET` (identique sur le web et le worker)                              |
| Resend        | Vérifier le domaine (SPF, DKIM, DMARC), créer une clé API                                                    | `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`                                           |
| Google        | Identifiants OAuth « application web », URI de redirection `https://altydetect.com/api/auth/callback/google` | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`                                         |
| Anthropic     | Clé API de production                                                                                        | `ANTHROPIC_API_KEY`                                                            |
| Stripe        | Voir l'étape 3                                                                                               | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID` |
| Base et Redis | Créer les deux services                                                                                      | `DATABASE_URL`, `REDIS_URL`                                                    |

Ne jamais définir en production : `ALTY_E2E`, `ALTY_LLM=fake`, `AUTH_EMAIL_TRANSPORT=log`,
`STRIPE_API_BASE`. Le code refuse de démarrer ces modes en production.

## 2. Base de données

```bash
DATABASE_URL=… pnpm -C apps/web db:migrate
```

À relancer à chaque déploiement qui ajoute une migration (`infra/migrations/`).

## 3. Stripe

1. **Mode test d'abord.** Avec la clé `sk_test_…` :

   ```bash
   STRIPE_SECRET_KEY=sk_test_… STRIPE_PORTAL_RETURN_URL=https://altydetect.com/fr/app/compte pnpm stripe:seed
   ```

   Le script crée le produit Pro, les prix mensuel (9,99 €) et annuel (95,88 €) depuis
   `plans.ts`, et la configuration du portail (résiliation en fin de période). Reporter
   l'identifiant affiché dans `STRIPE_PORTAL_CONFIGURATION_ID`.

2. **Webhook** : point de terminaison `https://altydetect.com/api/webhooks/stripe`, événements
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Reporter le secret `whsec_…` dans
   `STRIPE_WEBHOOK_SECRET`.
3. Vérifier le parcours avec une carte de test (`4242 4242 4242 4242`), puis refaire les étapes 1
   et 2 avec les clés live.
4. Dans le tableau de bord Stripe : activer les e-mails de reçu et de relance, renseigner les
   informations légales et fiscales (TVA).

## 4. Web (Vercel)

- Répertoire racine : `apps/web` ; commande d'installation : `pnpm install` (à la racine du dépôt) ;
  build : `pnpm build`.
- Toutes les variables de l'étape 1.
- `NEXT_PUBLIC_APP_URL` doit être défini **au moment du build** (sitemap, robots, liens).

## 5. Worker (Railway ou Render)

- Commande de démarrage : `pnpm -C apps/web worker`.
- Variables : `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`.
- Un seul exemplaire suffit au lancement ; la tâche de rétention est planifiée par BullMQ
  (03:15 UTC) et ne s'exécute qu'une fois même avec plusieurs workers.

## 6. Indexa (phase 2)

- **API** : image `services/indexa/Dockerfile` (commande par défaut : uvicorn sur le port 8002).
  Variables : `DATABASE_URL`, `REDIS_URL`, `INDEXA_INTERNAL_TOKEN`. Routes internes protégées par
  ce jeton ; domaine public nécessaire si le web est sur Vercel (section 8).
- **Worker** : même image, commande `/app/.venv/bin/rq worker indexa --url "$REDIS_URL"`.
  Variables : celles de l'API, plus `BRAVE_SEARCH_API_KEY`, `INDEXA_MAX_QUERIES`,
  `INDEXA_MAX_PAGES`.
- **Web** : `INDEXA_URL` (adresse de l'API) et le même `INDEXA_INTERNAL_TOKEN`.
- Les tables de la base privée sont créées par `pnpm -C apps/web db:migrate`.
- Mesurer le rappel réel avec Brave sur un échantillon de pages avant d'annoncer la fonction
  (le benchmark du dépôt simule la recherche web).

## 7. Veritas (phase 3, ADR-0008, ADR-0015)

Veritas est le seul moteur de détection servi aux utilisateurs (ADR-0015). Aucun fournisseur
externe n'est configuré en production ; le mode fantôme et son worker `veritas-shadow` ne
servent plus.

- **API** : image `services/veritas/Dockerfile` (uvicorn sur le port 8001). Variables :
  `VERITAS_INTERNAL_TOKEN`, `VERITAS_ENV=production`,
  `VERITAS_MODEL_DIR=/app/services/veritas/models`, `MODAL_TOKEN_ID` et `MODAL_TOKEN_SECRET`
  (couche 2 sur Modal). Laisser `DETECTION_PROVIDER` vide. Routes internes protégées par
  `VERITAS_INTERNAL_TOKEN`.
- **Modèles livrés** : `services/veritas/models/fr` (VRT-DET-FR-0.6, seuil 0,93) et
  `services/veritas/models/en` (VRT-DET-EN-0.2, seuil 0,70), seuils dans
  `config/thresholds.yaml`.
- **Ouverture d'une langue** (ADR-0016 pour l'anglais, même démarche pour le français), après
  sa vérification sur des textes réels :
  1. `routing.yaml` : la langue passe à `serve: veritas`, `veritas_min_confidence: low` ; les
     autres langues et `default` à `serve: closed` (erreur `UNSUPPORTED_LANGUAGE`, mots rendus,
     message dans l'éditeur). Relu à chaud, sans redéploiement.
  2. Couche 2 déployée : workflow « Entraînement Veritas », étape `deploy` (application
     `altydetect-veritas-encoder`, aucun coût tant qu'elle n'est pas appelée).
  3. Suivre la facturation Modal et la latence la première semaine, puis chaque semaine.
  - Retour arrière : remettre la langue à `serve: closed` dans `routing.yaml`.
- **Avant toute ouverture**, Détecter répond `DETECTION_UNAVAILABLE` (aucun fournisseur) : le
  reste du site fonctionne.
- **Couche 2** : `modal deploy services/veritas/modal/encoder_app.py` (ou le workflow
  « Entraînement Veritas », étape `deploy`). GPU à la demande, arrêt après une minute sans
  requête.
- **Web** : `VERITAS_URL` (adresse de l'API) et le même `VERITAS_INTERNAL_TOKEN`.
- **Seuils et aiguillage** : `services/veritas/config/*.yaml`, relus à chaque modification.
  Pour les changer sans redéploiement, monter ce dossier en volume et le désigner par
  `VERITAS_CONFIG_DIR`.
- **Accord** : `GET /internal/v1/detect/agreement` (jeton interne) donne le taux d'accord par
  segment et par modèle ; la porte est franchie à 85 % sur un échantillon suffisant.

## 8. Recette Vercel + Neon + Upstash + Railway

### Ordre

1. **Neon** (PostgreSQL) et **Upstash** (Redis). Garder deux adresses Neon : la directe pour
   les migrations, celle du pooler (hôte en `-pooler`, `?sslmode=require`) pour les services.
   Pour Upstash, l'adresse `rediss://…` (TCP), jamais l'API REST : BullMQ et RQ en ont besoin.
2. **Migrations**, depuis un poste : `DATABASE_URL="<adresse directe>" pnpm -C apps/web db:migrate`.
3. **Railway** : `indexa-api` et `veritas-api`, pour obtenir leurs adresses publiques.
4. **Vercel**, avec ces adresses.
5. **Railway** : `worker` et `indexa-worker` (puis `veritas-shadow` quand un modèle est livré).
6. **Stripe** : webhook sur le domaine définitif (section 3).

Générer un jeton distinct pour Indexa et pour Veritas (`openssl rand -base64 32`) et reporter
chacun des deux côtés (Vercel et le service).

### Vercel (`apps/web`)

- Répertoire racine : `apps/web` ; laisser cochée l'inclusion des fichiers hors du répertoire
  racine (le site utilise `packages/*`). Build par défaut (`postinstall` lance `prisma generate`).
- Variables, en Production et en Preview :

| Variable                                | Valeur                                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`                          | Neon, adresse du pooler                                        |
| `REDIS_URL`                             | Upstash, `rediss://…`                                          |
| `NEXT_PUBLIC_APP_URL`                   | domaine public ; fixé au build : redéployer après modification |
| `AUTH_SECRET`                           | identique sur le worker (signe aussi les liens des PDF)        |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`  | redirection `https://<domaine>/api/auth/callback/google`       |
| `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`    | Resend, domaine vérifié                                        |
| `ANTHROPIC_API_KEY`                     | Réécrire et Écrire                                             |
| `STRIPE_SECRET_KEY`                     | `sk_live_…` en Production, `sk_test_…` en Preview              |
| `STRIPE_WEBHOOK_SECRET`                 | `whsec_…` du point de terminaison `/api/webhooks/stripe`       |
| `STRIPE_PORTAL_CONFIGURATION_ID`        | affiché par `pnpm stripe:seed` (une fois par mode Stripe)      |
| `INDEXA_URL`, `INDEXA_INTERNAL_TOKEN`   | domaine public de `indexa-api` ; même jeton que le service     |
| `VERITAS_URL`, `VERITAS_INTERNAL_TOKEN` | domaine public de `veritas-api` ; même jeton que le service    |

Ne jamais définir sur Vercel : `AUTH_EMAIL_TRANSPORT`, `ALTY_LLM`, `ALTY_E2E`, `STRIPE_API_BASE`,
`SHADOW_DATABASE_URL` (CI), `NODE_ENV` (fixé par Vercel), ni les variables des services.

### Railway

Tous les services viennent du dépôt, branche `main`. `DATABASE_URL` (Neon, pooler) et
`REDIS_URL` (Upstash) sont des variables partagées du projet. Les images Docker se construisent
depuis la racine du dépôt ; elles écoutent sur un port fixe, indiqué à Railway par `PORT` (ou
par le port cible du domaine public).

| Service         | Source et commande                                                        | Variables propres                                                                                                                                         | Domaine public |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `worker`        | build automatique (pnpm) ; démarrage `pnpm -C apps/web worker`            | `AUTH_SECRET` (identique à Vercel)                                                                                                                        | non            |
| `indexa-api`    | `RAILWAY_DOCKERFILE_PATH=services/indexa/Dockerfile`                      | `INDEXA_INTERNAL_TOKEN`, `PORT=8002`                                                                                                                      | oui            |
| `indexa-worker` | même image ; démarrage `/app/.venv/bin/rq worker indexa --url $REDIS_URL` | celles de `indexa-api`, `BRAVE_SEARCH_API_KEY`, `INDEXA_MAX_QUERIES=8`, `INDEXA_MAX_PAGES=10`                                                             | non            |
| `veritas-api`   | `RAILWAY_DOCKERFILE_PATH=services/veritas/Dockerfile`                     | `VERITAS_INTERNAL_TOKEN`, `PORT=8001`, `VERITAS_ENV=production`, `VERITAS_MODEL_DIR=/app/services/veritas/models`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | oui            |

- Pas de service `veritas-shadow` depuis ADR-0015. L'ouverture de chaque langue suit la
  section 7.
- Tant qu'aucune langue n'est ouverte, Détecter répond `DETECTION_UNAVAILABLE`. Ne jamais définir en production `VERITAS_ALLOW_SIMULATED`,
  `INDEXA_SEARCH_PROVIDER=fixtures` ni `INDEXA_FIXTURES_PATH`.
- Sans `worker`, les exports PDF restent en attente ; sans Indexa ou Veritas, Plagiat ou
  Détecter indiquent que le service ne répond pas. Le reste du site fonctionne.

## 9. Vérification de la porte de sortie

En production, en français puis en anglais :

1. Essai sans compte sur l'accueil, puis inscription par lien e-mail et connexion Google.
2. Réécriture d'un texte avec citations (passages protégés surlignés).
3. Passage à Pro (mensuel) par Stripe Checkout ; le compte affiche « Pro ».
4. Réécriture à 3 propositions, export PDF, ouverture du fichier.
5. Résiliation depuis « Gérer l'abonnement » ; le compte affiche la date de fin.
6. Les tests automatiques couvrent le même parcours avec Stripe et Claude simulés :
   `pnpm -C apps/web test:e2e`.
