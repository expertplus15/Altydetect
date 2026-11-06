"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";

/** Enregistre la langue d'interface sur le compte (ADR-0002). */
export async function saveUserLocale(locale: string): Promise<void> {
  if (locale !== "fr" && locale !== "en") return;
  const session = await auth();
  if (!session?.user?.id) return;
  await db.user.update({ where: { id: session.user.id }, data: { locale } });
}
