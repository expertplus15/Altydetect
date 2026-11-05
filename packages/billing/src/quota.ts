import {
  MIN_WORDS_FOR_DETECTION,
  PLAN_LIMITS,
  type BillingInterval,
  type PlanId,
} from "./config/plans";

// Quotas de détection (mots par période) et de réécriture (demandes par jour UTC).
// Toujours vérifiés côté serveur, avant traitement (CLAUDE.md §4.8). Le stockage est fourni par
// l'application (QuotaStore) et doit consommer de façon atomique : jamais au-delà de la limite.

export interface PlanSnapshot {
  plan: PlanId;
  interval: BillingInterval | null;
  /** Fin de la période Stripe en cours (Pro), sert d'ancre aux remises à zéro mensuelles. */
  currentPeriodEnd: Date | null;
}

export interface UsageRecord {
  periodStart: Date;
  detectionWordsUsed: number;
  rewriteRequestsToday: number;
  /** Minuit UTC du jour auquel se rapporte rewriteRequestsToday. */
  rewriteDate: Date;
}

export interface QuotaStore {
  getPlan(userId: string): Promise<PlanSnapshot>;
  getUsage(userId: string): Promise<UsageRecord | null>;
  /**
   * Ajoute des mots à la période commençant à periodStart (remise à zéro si l'enregistrement
   * appartient à une période antérieure). Refuse (null) si le total dépasserait limit.
   */
  addDetectionWords(
    userId: string,
    periodStart: Date,
    words: number,
    limit: number,
  ): Promise<UsageRecord | null>;
  /** Ajoute une demande au jour day (remise à zéro si jour antérieur). Refuse (null) au-delà de limit. */
  addRewriteRequest(userId: string, day: Date, limit: number): Promise<UsageRecord | null>;
}

export type QuotaRefusal = "QUOTA_EXCEEDED" | "TEXT_TOO_SHORT";

export interface QuotaStatus {
  allowed: boolean;
  reason: QuotaRefusal | null;
  used: number;
  limit: number;
  remaining: number;
  /** Début de la prochaine période (détection) ou du prochain jour UTC (réécriture). */
  resetsAt: Date;
  /** Vrai quand la limite est un usage équitable à ne pas afficher (Pro). */
  limitHidden: boolean;
}

// --- Périodes ---

/** Minuit UTC du jour de date. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function nextUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + 24 * 60 * 60 * 1000);
}

/** Ajoute des mois en ramenant le jour au dernier jour du mois si besoin (31 janv. + 1 = 28/29 févr.). */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

export interface DetectionPeriod {
  start: Date;
  end: Date;
}

/**
 * Période de quota de détection en cours.
 * - Gratuit (ou Pro sans date Stripe) : du 1er du mois UTC au 1er du mois suivant.
 * - Pro : fenêtres d'un mois alignées sur current_period_end (aussi pour l'abonnement annuel,
 *   dont le quota reste mensuel).
 */
export function detectionPeriod(plan: PlanSnapshot, now: Date): DetectionPeriod {
  if (plan.plan === "pro" && plan.currentPeriodEnd) {
    const anchor = plan.currentPeriodEnd;
    // Nombre de mois entre l'ancre et maintenant, puis ajustement d'un cran si besoin.
    let k =
      (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - anchor.getUTCMonth());
    while (addMonthsClamped(anchor, k).getTime() > now.getTime()) k -= 1;
    while (addMonthsClamped(anchor, k + 1).getTime() <= now.getTime()) k += 1;
    return { start: addMonthsClamped(anchor, k), end: addMonthsClamped(anchor, k + 1) };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Mots déjà utilisés dans la période (0 si l'enregistrement date d'une période antérieure). */
export function detectionWordsUsed(usage: UsageRecord | null, period: DetectionPeriod): number {
  if (!usage || usage.periodStart.getTime() < period.start.getTime()) return 0;
  return usage.detectionWordsUsed;
}

/** Réécritures déjà faites aujourd'hui (0 si l'enregistrement date d'un jour antérieur). */
export function rewritesUsedToday(usage: UsageRecord | null, now: Date): number {
  if (!usage || usage.rewriteDate.getTime() < startOfUtcDay(now).getTime()) return 0;
  return usage.rewriteRequestsToday;
}

function status(
  used: number,
  limit: number,
  requested: number,
  resetsAt: Date,
  limitHidden: boolean,
): QuotaStatus {
  const allowed = used + requested <= limit;
  return {
    allowed,
    reason: allowed ? null : "QUOTA_EXCEEDED",
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt,
    limitHidden,
  };
}

// --- Fonctions de quota ---

// Propriétés fléchées (et non méthodes) : elles peuvent être extraites sans perdre leur contexte.
export interface Quota {
  checkDetectionQuota: (userId: string, wordCount: number) => Promise<QuotaStatus>;
  consumeDetectionQuota: (userId: string, wordCount: number) => Promise<QuotaStatus>;
  checkRewriteQuota: (userId: string) => Promise<QuotaStatus>;
  consumeRewriteQuota: (userId: string) => Promise<QuotaStatus>;
}

export function createQuota(store: QuotaStore, clock: () => Date = () => new Date()): Quota {
  async function detection(userId: string, wordCount: number, consume: boolean) {
    const now = clock();
    const plan = await store.getPlan(userId);
    const limit = PLAN_LIMITS[plan.plan].detectionWordsPerMonth;
    const period = detectionPeriod(plan, now);
    const used = detectionWordsUsed(await store.getUsage(userId), period);

    // Sous 150 mots, jamais de score : refus avant toute consommation (CLAUDE.md §5).
    if (wordCount < MIN_WORDS_FOR_DETECTION) {
      return {
        ...status(used, limit, 0, period.end, false),
        allowed: false,
        reason: "TEXT_TOO_SHORT" as const,
      };
    }
    const checked = status(used, limit, wordCount, period.end, false);
    if (!consume || !checked.allowed) return checked;

    const updated = await store.addDetectionWords(userId, period.start, wordCount, limit);
    if (!updated) {
      // Une autre requête a consommé entre-temps.
      return status(limit, limit, wordCount, period.end, false);
    }
    return status(updated.detectionWordsUsed, limit, 0, period.end, false);
  }

  async function rewrite(userId: string, consume: boolean) {
    const now = clock();
    const plan = await store.getPlan(userId);
    const limits = PLAN_LIMITS[plan.plan];
    const limit = limits.rewriteRequestsPerDay;
    const resetsAt = nextUtcDay(now);
    const used = rewritesUsedToday(await store.getUsage(userId), now);
    const checked = status(used, limit, 1, resetsAt, limits.rewriteLimitIsFairUse);
    if (!consume || !checked.allowed) return checked;

    const updated = await store.addRewriteRequest(userId, startOfUtcDay(now), limit);
    if (!updated) {
      return status(limit, limit, 1, resetsAt, limits.rewriteLimitIsFairUse);
    }
    return status(updated.rewriteRequestsToday, limit, 0, resetsAt, limits.rewriteLimitIsFairUse);
  }

  return {
    checkDetectionQuota: (userId, wordCount) => detection(userId, wordCount, false),
    consumeDetectionQuota: (userId, wordCount) => detection(userId, wordCount, true),
    checkRewriteQuota: (userId) => rewrite(userId, false),
    consumeRewriteQuota: (userId) => rewrite(userId, true),
  };
}

/** Stockage en mémoire, pour les tests et le développement. Même sémantique que la version SQL. */
export function createMemoryQuotaStore(plans: Record<string, PlanSnapshot> = {}): QuotaStore & {
  usage: Map<string, UsageRecord>;
  setPlan(userId: string, plan: PlanSnapshot): void;
} {
  const usage = new Map<string, UsageRecord>();
  const planOf = (userId: string): PlanSnapshot =>
    plans[userId] ?? { plan: "free", interval: null, currentPeriodEnd: null };
  const current = (userId: string, now: Date): UsageRecord =>
    usage.get(userId) ?? {
      periodStart: new Date(0),
      detectionWordsUsed: 0,
      rewriteRequestsToday: 0,
      rewriteDate: startOfUtcDay(now),
    };

  return {
    usage,
    setPlan(userId, plan) {
      plans[userId] = plan;
    },
    getPlan: (userId) => Promise.resolve(planOf(userId)),
    getUsage: (userId) => Promise.resolve(usage.get(userId) ?? null),
    addDetectionWords(userId, periodStart, words, limit) {
      const record = current(userId, periodStart);
      const reset = record.periodStart.getTime() < periodStart.getTime();
      const total = (reset ? 0 : record.detectionWordsUsed) + words;
      if (total > limit) return Promise.resolve(null);
      const next = {
        ...record,
        periodStart: reset ? periodStart : record.periodStart,
        detectionWordsUsed: total,
      };
      usage.set(userId, next);
      return Promise.resolve(next);
    },
    addRewriteRequest(userId, day, limit) {
      const record = current(userId, day);
      const reset = record.rewriteDate.getTime() < day.getTime();
      const total = (reset ? 0 : record.rewriteRequestsToday) + 1;
      if (total > limit) return Promise.resolve(null);
      const next = {
        ...record,
        rewriteDate: reset ? day : record.rewriteDate,
        rewriteRequestsToday: total,
      };
      usage.set(userId, next);
      return Promise.resolve(next);
    },
  };
}
