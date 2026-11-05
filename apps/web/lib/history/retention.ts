import "server-only";
import { FREE_HISTORY_DAYS, PRO_HISTORY_MONTHS } from "@altydetect/billing";
import { db } from "@/lib/db";

/**
 * Applique la durée de conservation de l'historique selon le plan : 7 jours en Gratuit,
 * 12 mois en Pro. Supprime documents et analyses (en cascade). Lancée chaque jour par le worker.
 */
export async function applyRetention(now: Date = new Date()): Promise<number> {
  return db.$executeRaw`
    DELETE FROM documents d
    USING users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE d.user_id = u.id
      AND d.created_at < CASE
        WHEN s.plan = 'pro' THEN ${now}::timestamp - make_interval(months => ${PRO_HISTORY_MONTHS})
        ELSE ${now}::timestamp - make_interval(days => ${FREE_HISTORY_DAYS})
      END`;
}

/** Date avant laquelle l'historique n'est plus visible pour ce plan (même si la tâche n'a pas tourné). */
export function retentionCutoff(plan: "free" | "pro", now: Date = new Date()): Date {
  const cutoff = new Date(now);
  if (plan === "pro") cutoff.setUTCMonth(cutoff.getUTCMonth() - PRO_HISTORY_MONTHS);
  else cutoff.setUTCDate(cutoff.getUTCDate() - FREE_HISTORY_DAYS);
  return cutoff;
}
