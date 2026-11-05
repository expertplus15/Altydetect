import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/db";

/**
 * Supprime un compte et ses données : abonnement Stripe résilié et client Stripe supprimé
 * (les factures restent chez Stripe pour les obligations comptables), puis utilisateur effacé
 * avec, en cascade, sessions, comptes de connexion, abonnement, usage, documents et analyses.
 */
export async function deleteAccountData(
  userId: string,
  stripe: Pick<Stripe, "customers"> | null,
): Promise<void> {
  const subscription = await db.subscription.findUnique({ where: { userId } });
  if (subscription?.stripeCustomerId && stripe) {
    // Supprimer le client Stripe résilie aussi ses abonnements actifs.
    await stripe.customers.del(subscription.stripeCustomerId).catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      if (code !== "resource_missing") throw error;
    });
  }
  // Base privée du plagiat (espace = utilisateur en phase 2) ; empreintes supprimées en cascade.
  await db.privateSource.deleteMany({ where: { workspaceId: userId } });
  await db.user.delete({ where: { id: userId } });
}
