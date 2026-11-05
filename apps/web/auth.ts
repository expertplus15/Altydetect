import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { cookies } from "next/headers";
import { sendMagicLink } from "@/lib/auth/email";
import { db } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: { id: string; locale: "fr" | "en" } & DefaultSession["user"];
  }
}

// Auth.js : lien magique par e-mail (Resend, ADR-0003) et Google.
// Sessions stockées en base (table sessions) : vérifiées côté serveur à chaque requête.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  providers: [
    Resend({
      from: process.env.AUTH_EMAIL_FROM ?? "AltyDetect <connexion@altydetect.com>",
      maxAge: 30 * 60,
      sendVerificationRequest: sendMagicLink,
    }),
    Google({ allowDangerousEmailAccountLinking: true }),
  ],
  pages: {
    signIn: "/fr/connexion",
    verifyRequest: "/fr/connexion/verifier",
    error: "/fr/connexion",
  },
  callbacks: {
    session({ session, user }) {
      const locale = (user as { locale?: string }).locale === "en" ? "en" : "fr";
      return { ...session, user: { ...session.user, id: user.id, locale } };
    },
  },
  events: {
    // La langue du compte est celle de l'interface au moment de l'inscription.
    async createUser({ user }) {
      const locale = (await cookies()).get("NEXT_LOCALE")?.value === "en" ? "en" : "fr";
      if (user.id) {
        await db.user.update({ where: { id: user.id }, data: { locale } });
      }
    },
  },
});
