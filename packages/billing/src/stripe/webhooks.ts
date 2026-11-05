import type Stripe from "stripe";
import type { BillingInterval, PlanId } from "../config/plans";
import { intervalFromLookupKey } from "./catalog";

// Traitement des webhooks Stripe, indépendant de la base : l'application fournit un
// SubscriptionStore. Chaque événement est rejoué sans risque (même résultat s'il arrive deux fois).

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export interface SubscriptionState {
  plan: PlanId;
  interval: BillingInterval | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface SubscriptionStore {
  /** Enregistre l'état pour cet utilisateur (création ou mise à jour). */
  saveForUser(userId: string, state: SubscriptionState): Promise<void>;
  /** Met à jour l'abonnement rattaché à ce client Stripe. Retourne false si aucun n'existe. */
  saveForCustomer(stripeCustomerId: string, state: SubscriptionState): Promise<boolean>;
  /** Marque le paiement en échec sans changer le plan (Stripe relance le paiement). */
  markPaymentFailed(stripeCustomerId: string): Promise<void>;
}

export interface WebhookDeps {
  store: SubscriptionStore;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
}

export type WebhookOutcome = "updated" | "ignored";

/** Statuts Stripe qui donnent accès à Pro. past_due : Pro reste actif pendant les relances. */
const PRO_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function stateFromSubscription(subscription: Stripe.Subscription): SubscriptionState {
  const item = subscription.items.data[0];
  const customerId = idOf(subscription.customer);
  if (!customerId) {
    throw new Error("Abonnement Stripe sans client.");
  }
  const isPro = PRO_STATUSES.has(subscription.status);
  return {
    plan: isPro ? "pro" : "free",
    interval: isPro ? intervalFromLookupKey(item?.price.lookup_key) : null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: isPro ? subscription.id : null,
    status: subscription.status,
    currentPeriodEnd: isPro && item ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: isPro && subscription.cancel_at_period_end,
  };
}

function invoiceCustomer(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.customer);
}

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const subscriptionId = idOf(session.subscription);
      if (session.mode !== "subscription" || !userId || !subscriptionId) {
        return "ignored";
      }
      // On relit l'abonnement : l'événement peut arriver avant ou après customer.subscription.*.
      const subscription = await deps.retrieveSubscription(subscriptionId);
      await deps.store.saveForUser(userId, stateFromSubscription(subscription));
      return "updated";
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const state =
        event.type === "customer.subscription.deleted"
          ? { ...stateFromSubscription({ ...subscription, status: "canceled" }) }
          : stateFromSubscription(subscription);
      const found = await deps.store.saveForCustomer(state.stripeCustomerId, state);
      return found ? "updated" : "ignored";
    }
    case "invoice.payment_failed": {
      const customerId = invoiceCustomer(event.data.object);
      if (!customerId) return "ignored";
      await deps.store.markPaymentFailed(customerId);
      return "updated";
    }
    default:
      return "ignored";
  }
}
