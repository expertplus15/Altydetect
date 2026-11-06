# ADR-0003 — Fournisseur d'e-mail : Resend

- **Statut** : accepté
- **Date** : 2026-11-05
- **Décideurs** : équipe AltyDetect

## Contexte

L'authentification (Auth.js) repose sur un lien magique envoyé par e-mail. L'envoi doit être
fiable (délivrabilité), simple à intégrer, conforme au RGPD et peu coûteux au démarrage. Les
e-mails sont rédigés en français et en anglais selon la langue de la page d'origine.

Options : Resend, Postmark, Amazon SES, un serveur SMTP générique via Nodemailer.

## Décision

Nous utilisons **Resend** via son API HTTP, appelée directement avec `fetch` dans
`apps/web/lib/auth/email.ts`. Aucune dépendance supplémentaire : le fournisseur `Resend` d'Auth.js
est utilisé avec notre propre `sendVerificationRequest` pour rédiger l'e-mail dans la bonne langue.

- Expéditeur : `AUTH_EMAIL_FROM`, sur un domaine vérifié dans Resend (SPF, DKIM, DMARC).
- Lien valable 30 minutes, à usage unique.
- `AUTH_EMAIL_TRANSPORT=log` dépose le lien dans Redis au lieu de l'envoyer : réservé aux tests
  de bout en bout, refusé en production.

## Conséquences

- Offre gratuite suffisante au lancement ; tarif à l'usage ensuite.
- Resend héberge aux États-Unis par défaut : un DPA et les clauses contractuelles types sont à
  signer, et la région UE est à demander si elle est disponible pour le compte.
- Changer de fournisseur ne touche que `sendMagicLink` : le reste d'Auth.js ne change pas.
- Les e-mails transactionnels futurs (facture échouée, suppression de compte) passeront par la
  même fonction d'envoi.
