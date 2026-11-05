// Règles d'accès de proxy.ts, isolées pour être testées.

/** Noms du cookie de session Auth.js (HTTP en local, HTTPS en production). */
export const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

/** Vrai pour /fr/app, /en/app et tout ce qui est en dessous. */
export function isProtectedPath(pathname: string): boolean {
  return /^\/(fr|en)\/app(\/|$)/.test(pathname);
}

/** Langue tirée du chemin, fr par défaut. */
export function localeFromPath(pathname: string): "fr" | "en" {
  return pathname.startsWith("/en/") || pathname === "/en" ? "en" : "fr";
}

/** Adresse de la page de connexion dans la langue du chemin, avec retour vers la page demandée. */
export function signInRedirectPath(pathname: string, search: string): string {
  const locale = localeFromPath(pathname);
  const signIn = locale === "en" ? "/en/sign-in" : "/fr/connexion";
  return `${signIn}?callbackUrl=${encodeURIComponent(pathname + search)}`;
}

/** Garde un callbackUrl local (évite une redirection ouverte vers un autre site). */
export function safeCallbackUrl(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}
