import { handleStripeEvent } from "@altydetect/billing";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { prismaSubscriptionStore } from "@/lib/billing/subscription-store";

// Webhooks Stripe : signature vérifiée, puis traitement par @altydetect/billing.
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return Response.json({ error: "signature manquante" }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return Response.json({ error: "signature invalide" }, { status: 400 });
  }

  const outcome = await handleStripeEvent(event, {
    store: prismaSubscriptionStore,
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
  });
  return Response.json({ received: true, outcome });
}
