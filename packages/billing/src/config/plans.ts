// Plans et limites d'AltyDetect. Source unique : Stripe (scripts/stripe-seed.ts),
// les quotas (quota.ts) et l'interface lisent ces constantes, jamais de valeur en dur ailleurs.

export type PlanId = "free" | "pro";
export type BillingInterval = "monthly" | "yearly";

// --- Gratuit ---
export const FREE_DETECTION_WORDS_PER_MONTH: number = 5000;
/** Demandes par jour, partagées entre Réécrire et les outils d'Écrire qui appellent le modèle. */
export const FREE_REWRITE_REQUESTS_PER_DAY: number = 3;
export const FREE_HISTORY_DAYS: number = 7;

// --- Pro ---
export const PRO_PRICE_MONTHLY_EUR: number = 9.99;
/** 7,99 €/mois facturés à l'année, soit −20 %. */
export const PRO_PRICE_YEARLY_EUR: number = 95.88;
export const PRO_DETECTION_WORDS_PER_MONTH: number = 100000;
/** Limite d'usage équitable : appliquée côté serveur, jamais affichée. */
export const PRO_REWRITE_FAIR_USE_PER_DAY: number = 300;
export const PRO_HISTORY_MONTHS: number = 12;

// --- Commun ---
export const MIN_WORDS_FOR_DETECTION: number = 150;

// --- Plagiat (phase 2) ---
// Les mots analysés pour le plagiat sont décomptés du quota de détection (décision phase 2).
/** Nombre maximal de documents de la base privée en Pro : sans limite (décision phase 2). */
export const PRO_PRIVATE_SOURCES_MAX: number | null = null;

// --- Équipe et API : non implémentés en phase 1 ---
/** TODO : prix du plan Équipe ([PRIX ÉQUIPE] du PRD). */
export const TEAM_PRICE_MONTHLY_EUR: number | null = null;
/** TODO : prix annuel du plan Équipe. */
export const TEAM_PRICE_YEARLY_EUR: number | null = null;
/** TODO : quota de détection du plan Équipe. */
export const TEAM_DETECTION_WORDS_PER_MONTH: number | null = null;
/** TODO : nombre de sièges inclus dans le plan Équipe. */
export const TEAM_SEATS_INCLUDED: number | null = null;
/** TODO : prix de l'API pour 1 000 mots ([PRIX API] du PRD). */
export const API_PRICE_PER_1000_WORDS_EUR: number | null = null;
/** TODO : quota mensuel inclus de l'API. */
export const API_INCLUDED_WORDS_PER_MONTH: number | null = null;

export interface PlanLimits {
  detectionWordsPerMonth: number;
  /** Nombre de réécritures par jour (UTC). */
  rewriteRequestsPerDay: number;
  /** Vrai si la limite quotidienne est une limite d'usage équitable non affichée. */
  rewriteLimitIsFairUse: boolean;
  historyDays: number;
}

export const PLAN_LIMITS: Readonly<Record<PlanId, PlanLimits>> = {
  free: {
    detectionWordsPerMonth: FREE_DETECTION_WORDS_PER_MONTH,
    rewriteRequestsPerDay: FREE_REWRITE_REQUESTS_PER_DAY,
    rewriteLimitIsFairUse: false,
    historyDays: FREE_HISTORY_DAYS,
  },
  pro: {
    detectionWordsPerMonth: PRO_DETECTION_WORDS_PER_MONTH,
    rewriteRequestsPerDay: PRO_REWRITE_FAIR_USE_PER_DAY,
    rewriteLimitIsFairUse: true,
    // 12 mois exprimés en jours pour un calcul de rétention unique.
    historyDays: PRO_HISTORY_MONTHS * 31,
  },
};

/** Prix Pro en centimes, pour Stripe. */
export const PRO_PRICES_CENTS: Readonly<Record<BillingInterval, number>> = {
  monthly: Math.round(PRO_PRICE_MONTHLY_EUR * 100),
  yearly: Math.round(PRO_PRICE_YEARLY_EUR * 100),
};
