import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getRedis } from "@/lib/server/redis";
import { claimTrialResult, dismissTrialResult } from "@/lib/server/trial-actions";
import { getTrialResult, TRIAL_COOKIE } from "@/lib/trial";

// Bandeau affiché après l'inscription quand un essai sans compte attend d'être enregistré.
export async function TrialClaim() {
  const trialId = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!trialId || !(await getTrialResult(getRedis(), trialId))) {
    return null;
  }
  const t = await getTranslations("trial");
  return (
    <section
      aria-labelledby="trial-claim-title"
      className="flex flex-wrap items-center gap-4 rounded-xl border border-accent/30 bg-accent/5 p-4"
    >
      <div className="min-w-0 flex-1">
        <h2 id="trial-claim-title" className="font-semibold text-gray-900">
          {t("saveTitle")}
        </h2>
        <p className="text-sm text-gray-600">{t("saveBody")}</p>
      </div>
      <form action={dismissTrialResult}>
        <button
          type="submit"
          className="h-11 rounded-lg px-4 text-sm text-gray-700 hover:bg-gray-100"
        >
          {t("dismiss")}
        </button>
      </form>
      <form action={claimTrialResult}>
        <button
          type="submit"
          className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("save")}
        </button>
      </form>
    </section>
  );
}
