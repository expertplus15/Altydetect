import "server-only";
import type { PlanId } from "@altydetect/billing";
import { db } from "@/lib/db";

export interface UserPlan {
  plan: PlanId;
  status: string;
  interval: "monthly" | "yearly" | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
}

/** Plan de l'utilisateur ; sans abonnement enregistré, Gratuit. */
export async function getUserPlan(userId: string): Promise<UserPlan> {
  const subscription = await db.subscription.findUnique({ where: { userId } });
  if (!subscription) {
    return {
      plan: "free",
      status: "active",
      interval: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
    };
  }
  return {
    plan: subscription.plan,
    status: subscription.status,
    interval: subscription.interval,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    stripeCustomerId: subscription.stripeCustomerId,
  };
}
