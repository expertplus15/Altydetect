"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { signOut } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { getStripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { deleteAccountData } from "./delete";

export interface AccountFormState {
  status: "idle" | "saved" | "mismatch";
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Préférences : langue d'interface et consentement à l'entraînement (désactivé par défaut). */
export async function savePreferences(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const locale = field(formData, "locale") === "en" ? "en" : "fr";
  await db.user.update({
    where: { id: user.id },
    data: { locale, trainingOptIn: formData.get("trainingOptIn") === "on" },
  });
  revalidatePath("/[locale]/app", "layout");
  if (locale !== (await getLocale())) {
    redirect({ href: "/app/compte", locale });
  }
  return { status: "saved" };
}

/** Suppression définitive du compte, confirmée par la saisie de l'adresse e-mail. */
export async function deleteAccount(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  if (field(formData, "confirmEmail").trim().toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return { status: "mismatch" };
  }
  await deleteAccountData(user.id, process.env.STRIPE_SECRET_KEY ? getStripe() : null);
  const locale = await getLocale();
  await signOut({ redirect: false }).catch(() => undefined);
  redirect({ href: "/", locale });
  return { status: "idle" };
}
