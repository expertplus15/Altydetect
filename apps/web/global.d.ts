import type { routing } from "@/i18n/routing";
import type messages from "./messages/fr.json";

// Typage des clés i18n : une clé absente de fr.json est une erreur de compilation.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
