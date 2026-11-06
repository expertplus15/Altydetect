import { MIN_WORDS_FOR_DETECTION } from "@altydetect/billing";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { DeleteAccountForm, PreferencesForm } from "@/components/account/AccountForms";
import { Link } from "@/i18n/navigation";
import { checkDetectionQuota, checkRewriteQuota } from "@/lib/billing/quota";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/session";

function Meter({
  label,
  used,
  limit,
  note,
}: {
  label: string;
  used: string;
  limit: string | null;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-gray-600">{limit ? `${used} / ${limit}` : used}</span>
      </div>
      <p className="text-xs text-gray-600">{note}</p>
    </div>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const sessionUser = await requireUser();
  const { checkout } = await searchParams;
  const t = await getTranslations("account");
  const format = await getFormatter();
  const locale = await getLocale();
  const [user, plan, detection, rewrite] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: sessionUser.id } }),
    getUserPlan(sessionUser.id),
    checkDetectionQuota(sessionUser.id, MIN_WORDS_FOR_DETECTION),
    checkRewriteQuota(sessionUser.id),
  ]);
  const date = (value: Date) => format.dateTime(value, { dateStyle: "long" });
  const card = "flex flex-col gap-4 rounded-2xl border border-gray-200 p-5 md:p-6";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <h1 className="text-[22px] font-semibold tracking-tight">{t("title")}</h1>

      {checkout === "success" && (
        <p
          role="status"
          className="rounded-lg bg-accent/10 px-4 py-3 text-sm font-medium text-accent"
        >
          {plan.plan === "pro" ? t("checkoutSuccess") : t("checkoutPending")}
        </p>
      )}

      <section aria-labelledby="plan" className={card}>
        <h2 id="plan" className="font-semibold">
          {t("plan")}
        </h2>
        <p className="text-2xl font-bold">
          {plan.plan === "pro" ? t("planPro") : t("planFree")}
          {plan.plan === "pro" && plan.interval && (
            <span className="ml-2 text-base font-normal text-gray-600">
              ({t(`interval.${plan.interval}`)})
            </span>
          )}
        </p>
        {plan.plan === "pro" && plan.currentPeriodEnd && (
          <p className="text-sm text-gray-700">
            {plan.cancelAtPeriodEnd
              ? t("ends", { date: date(plan.currentPeriodEnd) })
              : t("renews", { date: date(plan.currentPeriodEnd) })}
          </p>
        )}
        {plan.status === "past_due" && (
          <p role="alert" className="text-sm text-state-ai">
            {t("pastDue")}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {plan.stripeCustomerId && (
            <form action="/api/billing/portal" method="post">
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="h-11 rounded-lg border border-gray-300 px-4 font-medium hover:bg-gray-50"
              >
                {t("manage")}
              </button>
            </form>
          )}
          {plan.plan !== "pro" && (
            <Link
              href="/tarifs"
              className="inline-flex h-11 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
            >
              {t("upgrade")}
            </Link>
          )}
        </div>
      </section>

      <section aria-labelledby="usage" className={card}>
        <h2 id="usage" className="font-semibold">
          {t("usage")}
        </h2>
        <Meter
          label={t("detectionWords")}
          used={format.number(detection.used)}
          limit={format.number(detection.limit)}
          note={t("resets", { date: date(detection.resetsAt) })}
        />
        <Meter
          label={t("rewritesToday")}
          used={format.number(rewrite.used)}
          limit={rewrite.limitHidden ? null : format.number(rewrite.limit)}
          note={`${rewrite.limitHidden ? `${t("fairUse")} · ` : ""}${t("resets", { date: format.dateTime(rewrite.resetsAt, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) })}`}
        />
      </section>

      <section className={card}>
        <PreferencesForm locale={user.locale} trainingOptIn={user.trainingOptIn} />
      </section>

      <section aria-labelledby="delete" className={`${card} border-state-ai/40`}>
        <h2 id="delete" className="font-semibold text-state-ai">
          {t("delete")}
        </h2>
        <DeleteAccountForm email={user.email} />
      </section>
    </div>
  );
}
