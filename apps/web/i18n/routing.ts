import { defineRouting } from "next-intl/routing";

// Langue d'interface dans l'URL (ADR-0002) : fr par défaut, en.
// Chaque page a une adresse traduite ; les liens internes utilisent la clé (adresse française).
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  pathnames: {
    "/": "/",
    "/tarifs": { fr: "/tarifs", en: "/pricing" },
    "/connexion": { fr: "/connexion", en: "/sign-in" },
    "/inscription": { fr: "/inscription", en: "/sign-up" },
    "/connexion/verifier": { fr: "/connexion/verifier", en: "/sign-in/check-email" },
    "/app": "/app",
    "/app/reecrire": { fr: "/app/reecrire", en: "/app/rewrite" },
    "/app/ecrire": { fr: "/app/ecrire", en: "/app/write" },
    "/app/corriger": { fr: "/app/corriger", en: "/app/correct" },
    "/app/detecter": { fr: "/app/detecter", en: "/app/detect" },
    "/app/plagiat": { fr: "/app/plagiat", en: "/app/plagiarism" },
    "/app/historique": { fr: "/app/historique", en: "/app/history" },
    "/app/compte": { fr: "/app/compte", en: "/app/account" },
    "/cgu": { fr: "/cgu", en: "/terms" },
    "/confidentialite": { fr: "/confidentialite", en: "/privacy" },
    "/mentions-legales": { fr: "/mentions-legales", en: "/legal-notice" },
  },
});

export type AppLocale = (typeof routing.locales)[number];
export type AppPathname = keyof typeof routing.pathnames;
