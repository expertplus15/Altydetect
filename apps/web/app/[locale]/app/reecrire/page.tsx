import { RewriteWorkspace } from "@/components/rewrite/RewriteWorkspace";
import { TrialClaim } from "@/components/trial/TrialClaim";
import { checkRewriteQuota } from "@/lib/billing/quota";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/session";

export default async function RewritePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; variant?: string }>;
}) {
  const user = await requireUser();
  const { from, variant } = await searchParams;
  const [{ plan }, quota] = await Promise.all([getUserPlan(user.id), checkRewriteQuota(user.id)]);

  // « Rouvrir » depuis l'historique : la proposition retenue devient le texte de départ.
  let initialText = "";
  if (from) {
    const analysis = await db.analysis.findFirst({
      where: { id: from, type: "rewrite", document: { userId: user.id } },
    });
    const variants = (
      analysis?.resultJson as { output?: { variants?: { text: string }[] } } | undefined
    )?.output?.variants;
    initialText = variants?.[Number(variant ?? 0)]?.text ?? "";
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 empty:hidden md:px-6">
        <TrialClaim />
      </div>
      <RewriteWorkspace
        isPro={plan === "pro"}
        maxVariants={plan === "pro" ? 3 : 1}
        remaining={quota.limitHidden ? null : quota.remaining}
        canImport={plan === "pro"}
        initialText={initialText}
      />
    </div>
  );
}
