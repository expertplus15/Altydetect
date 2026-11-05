"use server";

import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { getLocale } from "next-intl/server";
import { signIn, signOut } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { safeCallbackUrl } from "./protected";

export interface AuthFormState {
  error: "invalidEmail" | "error" | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function callbackFrom(formData: FormData, locale: string): string {
  return safeCallbackUrl(field(formData, "callbackUrl"), `/${locale}/app`);
}

/** Envoie le lien magique, puis affiche la page « Vérifiez votre boîte de réception ». */
export async function requestMagicLink(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const locale = await getLocale();
  const email = field(formData, "email").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { error: "invalidEmail" };
  }
  // La langue du compte créé suit celle de la page (lue par events.createUser).
  (await cookies()).set("NEXT_LOCALE", locale, { path: "/", sameSite: "lax" });
  try {
    await signIn("resend", { email, redirect: false, redirectTo: callbackFrom(formData, locale) });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "error" };
    }
    throw error;
  }
  redirect({ href: "/connexion/verifier", locale });
  return { error: null };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const locale = await getLocale();
  (await cookies()).set("NEXT_LOCALE", locale, { path: "/", sameSite: "lax" });
  await signIn("google", { redirectTo: callbackFrom(formData, locale) });
}

export async function signOutAction(): Promise<void> {
  const locale = await getLocale();
  await signOut({ redirectTo: `/${locale}` });
}
