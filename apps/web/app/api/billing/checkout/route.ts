import { auth } from "@/auth";
import { getPathname } from "@/i18n/navigation";
import { getStripe, proPriceId } from "@/lib/billing/stripe";
import { getUserPlan } from "@/lib/billing/subscription";

function appUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

// Formulaire « Passer à Pro » : crée une session Stripe Checkout et redirige vers Stripe.
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const locale = form.get("locale") === "en" ? "en" : "fr";
  const interval = form.get("interval") === "monthly" ? "monthly" : "yearly";
  const base = appUrl(request);
  const pricing = getPathname({ href: "/tarifs", locale });

  const session = await auth();
  if (!session?.user?.id) {
    const signUp = getPathname({ href: "/inscription", locale });
    return Response.redirect(`${base}${signUp}?callbackUrl=${encodeURIComponent(pricing)}`, 303);
  }

  const current = await getUserPlan(session.user.id);
  const account = getPathname({ href: "/app/compte", locale });
  if (current.plan === "pro") {
    // Déjà Pro : la gestion se fait dans le portail.
    return Response.redirect(`${base}${account}`, 303);
  }

  const checkout = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: await proPriceId(interval), quantity: 1 }],
    client_reference_id: session.user.id,
    ...(current.stripeCustomerId
      ? { customer: current.stripeCustomerId }
      : session.user.email
        ? { customer_email: session.user.email }
        : {}),
    locale,
    allow_promotion_codes: false,
    billing_address_collection: "auto",
    subscription_data: { metadata: { userId: session.user.id } },
    success_url: `${base}${account}?checkout=success`,
    cancel_url: `${base}${pricing}?checkout=cancelled`,
  });
  if (!checkout.url) {
    return Response.json({ error: "session Stripe sans URL" }, { status: 502 });
  }
  return Response.redirect(checkout.url, 303);
}
