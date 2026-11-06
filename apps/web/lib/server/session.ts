import "server-only";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";

/** Session obligatoire : sinon, redirection vers la connexion (deuxième barrière après proxy.ts). */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    const locale = await getLocale();
    return redirect({ href: "/connexion", locale });
  }
  return session.user;
}
