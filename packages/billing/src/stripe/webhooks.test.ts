import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRO_PRICE_LOOKUP_KEYS } from "./catalog";
import { handleStripeEvent, type SubscriptionState, type WebhookDeps } from "./webhooks";

const PERIOD_END = 1_798_761_600; // 2027-01-01T00:00:00Z

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    items: {
      object: "list",
      data: [
        {
          current_period_end: PERIOD_END,
          price: { lookup_key: PRO_PRICE_LOOKUP_KEYS.yearly },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function event(type: string, object: unknown): Stripe.Event {
  return { id: `evt_${type}`, type, data: { object } } as unknown as Stripe.Event;
}

describe("webhooks Stripe", () => {
  let saved: { userId?: string; customerId?: string; state: SubscriptionState }[];
  let deps: WebhookDeps & { store: { markPaymentFailed: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    saved = [];
    deps = {
      retrieveSubscription: vi.fn(() => Promise.resolve(subscription())),
      store: {
        saveForUser: vi.fn((userId: string, state: SubscriptionState) => {
          saved.push({ userId, state });
          return Promise.resolve();
        }),
        saveForCustomer: vi.fn((customerId: string, state: SubscriptionState) => {
          saved.push({ customerId, state });
          return Promise.resolve(customerId === "cus_1");
        }),
        markPaymentFailed: vi.fn(() => Promise.resolve()),
      },
    };
  });

  it("checkout.session.completed active Pro pour l'utilisateur du paiement", async () => {
    const outcome = await handleStripeEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: "user_1",
        subscription: "sub_1",
      }),
      deps,
    );
    expect(outcome).toBe("updated");
    expect(deps.retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(saved).toEqual([
      {
        userId: "user_1",
        state: {
          plan: "pro",
          interval: "yearly",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
          status: "active",
          currentPeriodEnd: new Date(PERIOD_END * 1000),
          cancelAtPeriodEnd: false,
        },
      },
    ]);
  });

  it("ignore un checkout sans utilisateur ou hors abonnement", async () => {
    expect(
      await handleStripeEvent(
        event("checkout.session.completed", { mode: "payment", client_reference_id: "u" }),
        deps,
      ),
    ).toBe("ignored");
    expect(
      await handleStripeEvent(
        event("checkout.session.completed", { mode: "subscription", subscription: "sub_1" }),
        deps,
      ),
    ).toBe("ignored");
    expect(saved).toHaveLength(0);
  });

  it("customer.subscription.updated enregistre la résiliation programmée", async () => {
    await handleStripeEvent(
      event("customer.subscription.updated", subscription({ cancel_at_period_end: true })),
      deps,
    );
    expect(saved[0]?.state.plan).toBe("pro");
    expect(saved[0]?.state.cancelAtPeriodEnd).toBe(true);
  });

  it("customer.subscription.updated repasse en Gratuit quand Stripe abandonne (unpaid)", async () => {
    await handleStripeEvent(
      event("customer.subscription.updated", subscription({ status: "unpaid" })),
      deps,
    );
    expect(saved[0]?.state).toMatchObject({
      plan: "free",
      interval: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    });
  });

  it("past_due garde Pro pendant les relances de paiement", async () => {
    await handleStripeEvent(
      event("customer.subscription.updated", subscription({ status: "past_due" })),
      deps,
    );
    expect(saved[0]?.state.plan).toBe("pro");
  });

  it("customer.subscription.deleted repasse en Gratuit et garde le client Stripe", async () => {
    await handleStripeEvent(event("customer.subscription.deleted", subscription()), deps);
    expect(saved[0]?.state).toEqual({
      plan: "free",
      interval: null,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: null,
      status: "canceled",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });

  it("ignore un abonnement de client inconnu", async () => {
    expect(
      await handleStripeEvent(
        event("customer.subscription.updated", subscription({ customer: "cus_unknown" })),
        deps,
      ),
    ).toBe("ignored");
  });

  it("invoice.payment_failed marque l'échec sans changer le plan", async () => {
    expect(
      await handleStripeEvent(event("invoice.payment_failed", { customer: "cus_1" }), deps),
    ).toBe("updated");
    expect(deps.store.markPaymentFailed).toHaveBeenCalledWith("cus_1");
    expect(saved).toHaveLength(0);
  });

  it("ignore les autres événements", async () => {
    expect(await handleStripeEvent(event("customer.created", {}), deps)).toBe("ignored");
  });

  it("donne le même résultat si l'événement arrive deux fois", async () => {
    const e = event("customer.subscription.updated", subscription());
    await handleStripeEvent(e, deps);
    await handleStripeEvent(e, deps);
    expect(saved[0]).toEqual(saved[1]);
  });
});
