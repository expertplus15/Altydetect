import { auth } from "@/auth";
import { getPathname } from "@/i18n/navigation";
import { getStripe } from "@/lib/billing/stripe";
import { getUserPlan } from "@/lib/billing/subscription";

// Bouton « Gérer mon abonnement » : ouvre le portail client Stripe (résiliation en un clic).
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const locale = form.get("locale") === "en" ? "en" : "fr";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.redirect(`${base}${getPathname({ href: "/connexion", locale })}`, 303);
  }
  const { stripeCustomerId } = await getUserPlan(session.user.id);
  const account = `${base}${getPathname({ href: "/app/compte", locale })}`;
  if (!stripeCustomerId) {
    return Response.redirect(account, 303);
  }
  const portal = await getStripe().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: account,
    locale,
    ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
      ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
      : {}),
  });
  return Response.redirect(portal.url, 303);
}
