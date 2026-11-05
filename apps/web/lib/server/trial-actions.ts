"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/server/redis";
import { requireUser } from "@/lib/server/session";
import { takeTrialResult, TRIAL_COOKIE } from "@/lib/trial";

/** Enregistre le résultat de l'essai sans compte dans l'historique du nouvel utilisateur. */
export async function claimTrialResult(): Promise<void> {
  const user = await requireUser();
  const store = await cookies();
  const trialId = store.get(TRIAL_COOKIE)?.value;
  if (!trialId) {
    return;
  }
  const result = await takeTrialResult(getRedis(), trialId);
  if (result) {
    // Le texte original n'est pas enregistré (keep_text: false) ; seul le résultat l'est.
    await db.document.create({
      data: {
        userId: user.id,
        title: result.title,
        wordCount: result.wordCount,
        analyses: {
          create: {
            type: result.type,
            engine: result.engine,
            resultJson: result.result as object,
          },
        },
      },
    });
  }
  revalidatePath("/[locale]/app", "layout");
}

/** Abandonne le résultat de l'essai. */
export async function dismissTrialResult(): Promise<void> {
  await requireUser();
  const trialId = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (trialId) {
    await takeTrialResult(getRedis(), trialId);
  }
  revalidatePath("/[locale]/app", "layout");
}
