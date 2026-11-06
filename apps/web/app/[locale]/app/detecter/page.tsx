import { MIN_WORDS_FOR_DETECTION } from "@altydetect/billing";
import { DetectWorkspace } from "@/components/detect/DetectWorkspace";
import { checkDetectionQuota } from "@/lib/billing/quota";
import { getUserPlan } from "@/lib/billing/subscription";
import { requireUser } from "@/lib/server/session";

export default async function DetectPage() {
  const user = await requireUser();
  const [{ plan }, quota] = await Promise.all([
    getUserPlan(user.id),
    checkDetectionQuota(user.id, MIN_WORDS_FOR_DETECTION),
  ]);
  return (
    <DetectWorkspace isPro={plan === "pro"} quota={{ used: quota.used, limit: quota.limit }} />
  );
}
