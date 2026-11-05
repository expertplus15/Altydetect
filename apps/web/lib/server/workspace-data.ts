import "server-only";
import { MIN_WORDS_FOR_DETECTION } from "@altydetect/billing";
import type { HeaderData } from "@/components/shell/AppHeader";
import type { RecentDocument } from "@/components/shell/Sidebar";
import { checkDetectionQuota } from "@/lib/billing/quota";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";

/** Données communes à toutes les pages de l'espace : en-tête (plan, quota) et documents récents. */
export async function getWorkspaceData(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<{ header: HeaderData; recents: RecentDocument[] }> {
  const [plan, quota, documents] = await Promise.all([
    getUserPlan(user.id),
    checkDetectionQuota(user.id, MIN_WORDS_FOR_DETECTION),
    db.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        createdAt: true,
        analyses: { select: { type: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);
  return {
    header: {
      plan: plan.plan,
      detectionUsed: quota.used,
      detectionLimit: quota.limit,
      name: user.name ?? null,
      email: user.email ?? "",
    },
    recents: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      type: doc.analyses[0]?.type ?? null,
      createdAt: doc.createdAt.toISOString(),
    })),
  };
}
