import "server-only";
import Stripe from "stripe";
import { PRO_PRICE_LOOKUP_KEYS, type BillingInterval } from "@altydetect/billing";

let client: Stripe | null = null;

/**
 * STRIPE_API_BASE (tests de bout en bout uniquement) : envoie les appels à un Stripe simulé
 * local. Refusé en production réelle.
 */
function testApiHost(): { host?: string; port?: number; protocol?: "http" | "https" } {
  const base = process.env.STRIPE_API_BASE;
  if (!base) return {};
  if (process.env.NODE_ENV === "production" && process.env.ALTY_E2E !== "1") {
    throw new Error("STRIPE_API_BASE est interdit en production.");
  }
  const url = new URL(base);
  return {
    host: url.hostname,
    port: Number(url.port),
    protocol: url.protocol === "https:" ? "https" : "http",
  };
}

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY manquante : voir .env.example.");
    }
    client = new Stripe(key, { appInfo: { name: "AltyDetect" }, ...testApiHost() });
  }
  return client;
}

const priceCache = new Map<BillingInterval, string>();

/** Identifiant du prix Pro, retrouvé par lookup_key (créé par scripts/stripe-seed.ts). */
export async function proPriceId(interval: BillingInterval): Promise<string> {
  const cached = priceCache.get(interval);
  if (cached) return cached;
  const prices = await getStripe().prices.list({
    lookup_keys: [PRO_PRICE_LOOKUP_KEYS[interval]],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(`Prix Stripe introuvable (${interval}) : lancez pnpm stripe:seed.`);
  }
  priceCache.set(interval, price.id);
  return price.id;
}
