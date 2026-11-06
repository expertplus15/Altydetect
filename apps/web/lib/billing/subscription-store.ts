import "server-only";
import type { SubscriptionState, SubscriptionStore } from "@altydetect/billing";
import { db } from "@/lib/db";

// Implémentation Prisma du SubscriptionStore de @altydetect/billing.
export const prismaSubscriptionStore: SubscriptionStore = {
  async saveForUser(userId: string, state: SubscriptionState) {
    await db.subscription.upsert({
      where: { userId },
      create: { userId, ...state },
      update: state,
    });
  },

  async saveForCustomer(stripeCustomerId: string, state: SubscriptionState) {
    const result = await db.subscription.updateMany({ where: { stripeCustomerId }, data: state });
    return result.count > 0;
  },

  async markPaymentFailed(stripeCustomerId: string) {
    await db.subscription.updateMany({
      where: { stripeCustomerId },
      data: { status: "past_due" },
    });
  },
};
