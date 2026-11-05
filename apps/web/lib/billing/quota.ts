import "server-only";
import { createQuota, type QuotaStore, type UsageRecord } from "@altydetect/billing";
import { db } from "@/lib/db";

interface UsageRow {
  period_start: Date;
  detection_words_used: number;
  rewrite_requests_today: number;
  rewrite_date: Date;
}

function toRecord(row: UsageRow | undefined): UsageRecord | null {
  if (!row) return null;
  return {
    periodStart: row.period_start,
    detectionWordsUsed: row.detection_words_used,
    rewriteRequestsToday: row.rewrite_requests_today,
    rewriteDate: row.rewrite_date,
  };
}

/** Crée la ligne d'usage si elle manque (période et jour à l'époque : remis à zéro au premier usage). */
async function ensureUsageRow(userId: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO usage (id, user_id, period_start, rewrite_date, updated_at)
    VALUES (gen_random_uuid()::text, ${userId}, to_timestamp(0), DATE '1970-01-01', now())
    ON CONFLICT (user_id) DO NOTHING`;
}

// Chaque consommation est UNE requête UPDATE conditionnelle : remise à zéro de période, ajout et
// contrôle de la limite se font ensemble, sans course possible entre deux requêtes.
export const prismaQuotaStore: QuotaStore = {
  async getPlan(userId) {
    const subscription = await db.subscription.findUnique({ where: { userId } });
    return {
      plan: subscription?.plan ?? "free",
      interval: subscription?.interval ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    };
  },

  async getUsage(userId) {
    const usage = await db.usage.findUnique({ where: { userId } });
    return usage
      ? {
          periodStart: usage.periodStart,
          detectionWordsUsed: usage.detectionWordsUsed,
          rewriteRequestsToday: usage.rewriteRequestsToday,
          rewriteDate: usage.rewriteDate,
        }
      : null;
  },

  async addDetectionWords(userId, periodStart, words, limit) {
    await ensureUsageRow(userId);
    const rows = await db.$queryRaw<UsageRow[]>`
      UPDATE usage SET
        detection_words_used = CASE WHEN period_start < ${periodStart}
          THEN ${words} ELSE detection_words_used + ${words} END,
        period_start = GREATEST(period_start, ${periodStart}),
        updated_at = now()
      WHERE user_id = ${userId}
        AND (CASE WHEN period_start < ${periodStart}
          THEN ${words} ELSE detection_words_used + ${words} END) <= ${limit}
      RETURNING period_start, detection_words_used, rewrite_requests_today, rewrite_date`;
    return toRecord(rows[0]);
  },

  async addRewriteRequest(userId, day, limit) {
    await ensureUsageRow(userId);
    const rows = await db.$queryRaw<UsageRow[]>`
      UPDATE usage SET
        rewrite_requests_today = CASE WHEN rewrite_date < ${day}::date
          THEN 1 ELSE rewrite_requests_today + 1 END,
        rewrite_date = GREATEST(rewrite_date, ${day}::date),
        updated_at = now()
      WHERE user_id = ${userId}
        AND (CASE WHEN rewrite_date < ${day}::date THEN 1 ELSE rewrite_requests_today + 1 END) <= ${limit}
      RETURNING period_start, detection_words_used, rewrite_requests_today, rewrite_date`;
    return toRecord(rows[0]);
  },
};

// Fonctions de quota de l'application (CLAUDE.md §4.8 : toujours appelées côté serveur).
export const {
  checkDetectionQuota,
  consumeDetectionQuota,
  checkRewriteQuota,
  consumeRewriteQuota,
} = createQuota(prismaQuotaStore);
