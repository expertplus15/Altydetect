import { MIN_WORDS_FOR_DETECTION } from "@altydetect/billing";
import { PlagiarismScreen } from "@/components/plagiarism/PlagiarismScreen";
import { checkDetectionQuota } from "@/lib/billing/quota";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/session";

export default async function PlagiarismPage() {
  const user = await requireUser();
  const [{ plan }, quota, sources] = await Promise.all([
    getUserPlan(user.id),
    checkDetectionQuota(user.id, MIN_WORDS_FOR_DETECTION),
    db.privateSource.findMany({
      where: { workspaceId: user.id },
      select: { id: true, title: true },
    }),
  ]);
  return (
    <PlagiarismScreen
      isPro={plan === "pro"}
      quota={{ used: quota.used, limit: quota.limit }}
      privateTitles={Object.fromEntries(sources.map((s) => [s.id, s.title]))}
    />
  );
}
