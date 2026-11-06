import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRO_PRICE_LOOKUP_KEYS } from "@altydetect/billing";
import { getStripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { POST } from "./route";

// Test d'intégration : vraie signature Stripe et vraie base ; aucun appel réseau à Stripe.
const SECRET = "whsec_test_secret";
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy_key_for_tests";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const PERIOD_END = 1_798_761_600;

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_route_1",
    object: "subscription",
    customer: "cus_route_1",
    status: "active",
    cancel_at_period_end: false,
    items: {
      object: "list",
      data: [
        { current_period_end: PERIOD_END, price: { lookup_key: PRO_PRICE_LOOKUP_KEYS.monthly } },
      ],
    },
    ...overrides,
  };
}

async function send(type: string, object: unknown, secret = SECRET): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    object: "event",
    type,
    data: { object },
  });
  const header = await getStripe().webhooks.generateTestHeaderStringAsync({ payload, secret });
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": header },
      body: payload,
    }),
  );
}

describe.skipIf(!process.env.DATABASE_URL)("POST /api/webhooks/stripe", () => {
  const email = `stripe-route-${Date.now()}@example.test`;
  let userId: string;

  beforeAll(async () => {
    userId = (await db.user.create({ data: { email } })).id;
    vi.spyOn(getStripe().subscriptions, "retrieve").mockResolvedValue(
      subscription() as unknown as Stripe.Response<Stripe.Subscription>,
    );
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("refuse une signature invalide", async () => {
    const response = await send("customer.subscription.updated", subscription(), "whsec_autre");
    expect(response.status).toBe(400);
  });

  it("passe l'utilisateur en Pro après le paiement", async () => {
    const response = await send("checkout.session.completed", {
      object: "checkout.session",
      mode: "subscription",
      client_reference_id: userId,
      subscription: "sub_route_1",
    });
    expect(response.status).toBe(200);
    const saved = await db.subscription.findUniqueOrThrow({ where: { userId } });
    expect(saved).toMatchObject({
      plan: "pro",
      interval: "monthly",
      stripeCustomerId: "cus_route_1",
      stripeSubscriptionId: "sub_route_1",
      currentPeriodEnd: new Date(PERIOD_END * 1000),
    });
  });

  it("enregistre un échec de paiement", async () => {
    await send("invoice.payment_failed", { object: "invoice", customer: "cus_route_1" });
    const saved = await db.subscription.findUniqueOrThrow({ where: { userId } });
    expect(saved.status).toBe("past_due");
    expect(saved.plan).toBe("pro");
  });

  it("programme puis applique la résiliation", async () => {
    await send("customer.subscription.updated", subscription({ cancel_at_period_end: true }));
    expect((await db.subscription.findUniqueOrThrow({ where: { userId } })).cancelAtPeriodEnd).toBe(
      true,
    );

    await send("customer.subscription.deleted", subscription({ status: "canceled" }));
    const saved = await db.subscription.findUniqueOrThrow({ where: { userId } });
    expect(saved).toMatchObject({
      plan: "free",
      status: "canceled",
      stripeSubscriptionId: null,
      stripeCustomerId: "cus_route_1",
    });
  });
});
