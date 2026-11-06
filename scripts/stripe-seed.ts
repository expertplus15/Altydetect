/**
 * Crée ou met à jour le produit et les prix Pro dans Stripe à partir de plans.ts,
 * puis configure le portail client (résiliation en un clic, changement mensuel/annuel).
 * Peut être relancé sans risque : un prix identique est conservé.
 *
 * Usage : STRIPE_SECRET_KEY=sk_test_… pnpm stripe:seed
 */
import Stripe from "stripe";
import {
  PRO_CATALOG,
  PRO_PRODUCT_KEY,
  STRIPE_CURRENCY,
  planPriceActions,
} from "@altydetect/billing";

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY manquante.");
  }
  if (key.startsWith("sk_live_") && process.env.STRIPE_SEED_LIVE !== "1") {
    throw new Error("Clé live détectée : relancez avec STRIPE_SEED_LIVE=1 pour confirmer.");
  }
  const stripe = new Stripe(key);

  // Produit avec un identifiant fixe : retrouvé à chaque exécution.
  let product: Stripe.Product;
  try {
    product = await stripe.products.retrieve(PRO_PRODUCT_KEY);
  } catch {
    product = await stripe.products.create({
      id: PRO_PRODUCT_KEY,
      name: "AltyDetect Pro",
      description: "Réécrire, Écrire et quotas Pro.",
    });
    console.log(`Produit créé : ${product.id}`);
  }

  const existing = await stripe.prices.list({
    product: product.id,
    lookup_keys: PRO_CATALOG.map((p) => p.lookupKey),
    limit: 100,
  });
  const actions = planPriceActions(
    PRO_CATALOG,
    existing.data.map((p) => ({
      id: p.id,
      lookupKey: p.lookup_key,
      unitAmount: p.unit_amount,
      currency: p.currency,
      recurringInterval: p.recurring?.interval ?? null,
      active: p.active,
    })),
    STRIPE_CURRENCY,
  );

  const priceIds: string[] = [];
  for (const action of actions) {
    if (action.kind === "keep") {
      console.log(`Prix conservé : ${action.lookupKey} (${action.priceId})`);
      priceIds.push(action.priceId);
      continue;
    }
    const created = await stripe.prices.create({
      product: product.id,
      currency: STRIPE_CURRENCY,
      unit_amount: action.price.unitAmount,
      recurring: action.price.recurring,
      lookup_key: action.price.lookupKey,
      transfer_lookup_key: true,
      tax_behavior: "inclusive",
    });
    if (action.replaces) {
      await stripe.prices.update(action.replaces, { active: false });
    }
    console.log(`Prix créé : ${action.price.lookupKey} (${created.id})`);
    priceIds.push(created.id);
  }

  // Portail client : résiliation à la fin de la période, changement de période, factures.
  const portal = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "AltyDetect" },
    features: {
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products: [{ product: product.id, prices: priceIds }],
        proration_behavior: "create_prorations",
      },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
    },
    ...(process.env.STRIPE_PORTAL_RETURN_URL
      ? { default_return_url: process.env.STRIPE_PORTAL_RETURN_URL }
      : {}),
  });
  console.log(`Configuration du portail : ${portal.id}`);
  console.log(`À reporter dans STRIPE_PORTAL_CONFIGURATION_ID : ${portal.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
