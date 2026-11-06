import { defineRouting } from "next-intl/routing";

// Langue d'interface : fr par défaut, en. Indépendante de la langue du texte analysé.
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
});
