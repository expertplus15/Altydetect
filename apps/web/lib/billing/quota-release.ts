import "server-only";
import { startOfUtcDay } from "@altydetect/billing";
import { db } from "@/lib/db";

/** Rend une réécriture consommée quand le traitement a échoué (erreur du modèle, refus). */
export async function releaseRewriteRequest(userId: string, now: Date = new Date()): Promise<void> {
  const day = startOfUtcDay(now);
  await db.$executeRaw`
    UPDATE usage SET rewrite_requests_today = rewrite_requests_today - 1, updated_at = now()
    WHERE user_id = ${userId} AND rewrite_date = ${day}::date AND rewrite_requests_today > 0`;
}

/** Rend des mots de détection consommés par une analyse qui a échoué (plagiat). */
export async function releaseDetectionWords(userId: string, words: number): Promise<void> {
  await db.$executeRaw`
    UPDATE usage SET detection_words_used = GREATEST(0, detection_words_used - ${words}), updated_at = now()
    WHERE user_id = ${userId}`;
}
