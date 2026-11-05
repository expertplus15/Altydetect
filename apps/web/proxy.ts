import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { isProtectedPath, SESSION_COOKIE_NAMES, signInRedirectPath } from "./lib/auth/protected";

const intl = createMiddleware(routing);

// 1. /app/* sans cookie de session → page de connexion (la session est validée ensuite
//    côté serveur dans app/[locale]/app/layout.tsx).
// 2. Tout le reste → routage de langue next-intl.
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isProtectedPath(pathname)) {
    const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
    if (!hasSession) {
      return NextResponse.redirect(new URL(signInRedirectPath(pathname, search), request.url));
    }
  }
  return intl(request);
}

export const config = {
  // Toutes les routes sauf l'API, les fichiers internes de Next et les fichiers statiques.
  matcher: "/((?!api|internal|_next|_vercel|.*\\..*).*)",
};
