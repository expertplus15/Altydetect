# Mise en production — phase 1

Ce guide mène à la porte de sortie de la phase 1 : un abonnement Pro souscrit, utilisé pour
réécrire, exporté en PDF et résilié, en production, en français et en anglais.

## Architecture

| Composant                          | Rôle                                                      | Hébergement recommandé                                     |
| ---------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web` (Next.js)               | Site, espace de travail, routes internes, webhooks Stripe | Vercel                                                     |
| Worker (`pnpm -C apps/web worker`) | Exports PDF, rétention quotidienne de l'historique        | Railway ou Render (service toujours actif)                 |
| PostgreSQL 16 + pgvector           | Données                                                   | Railway, Render, Neon ou Supabase                          |
| Redis 7                            | Files BullMQ, essais sans compte, PDF temporaires         | Railway, Render ou Upstash (connexion TCP, pas l'API REST) |

Le web et le worker utilisent la **même** base et le **même** Redis.

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

## 6. Vérification de la porte de sortie

En production, en français puis en anglais :

1. Essai sans compte sur l'accueil, puis inscription par lien e-mail et connexion Google.
2. Réécriture d'un texte avec citations (passages protégés surlignés).
3. Passage à Pro (mensuel) par Stripe Checkout ; le compte affiche « Pro ».
4. Réécriture à 3 propositions, export PDF, ouverture du fichier.
5. Résiliation depuis « Gérer l'abonnement » ; le compte affiche la date de fin.
6. Les tests automatiques couvrent le même parcours avec Stripe et Claude simulés :
   `pnpm -C apps/web test:e2e`.
