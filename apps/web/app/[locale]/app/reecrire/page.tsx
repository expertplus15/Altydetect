import { RewriteScreen } from "@/components/rewrite/RewriteScreen";
import { TrialClaim } from "@/components/trial/TrialClaim";
import { checkRewriteQuota } from "@/lib/billing/quota";
import { getUserPlan } from "@/lib/billing/subscription";
import { requireUser } from "@/lib/server/session";

export default async function RewritePage() {
  const user = await requireUser();
  const [{ plan }, quota] = await Promise.all([getUserPlan(user.id), checkRewriteQuota(user.id)]);
  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 md:px-6 empty:hidden">
        <TrialClaim />
      </div>
      <RewriteScreen
        mode="app"
        maxVariants={plan === "pro" ? 3 : 1}
        remaining={quota.limitHidden ? null : quota.remaining}
        canImport={plan === "pro"}
      />
    </div>
  );
}
