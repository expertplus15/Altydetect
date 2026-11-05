import { FREE_HISTORY_DAYS, PRO_HISTORY_MONTHS } from "@altydetect/billing";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { retentionCutoff } from "@/lib/history/retention";
import { requireUser } from "@/lib/server/session";

type SearchParams = { type?: string; from?: string; to?: string; document?: string };

interface StoredResult {
  tool?: "outline" | "correct" | "summarize";
  input?: { register?: string };
  output?: {
    variants?: { text: string; changes_summary: string }[];
    title?: string;
    sections?: { heading: string; points: string[] }[];
    corrections?: { original: string; replacement: string; explanation: string }[];
    summary?: string;
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Historique : documents et analyses, filtres par type et par date, réouverture.
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const t = await getTranslations("history");
  const tr = await getTranslations("rewrite");
  const format = await getFormatter();
  const { plan } = await getUserPlan(user.id);
  const cutoff = retentionCutoff(plan);

  const type = params.type === "rewrite" || params.type === "write" ? params.type : "all";
  const createdAt: Prisma.DateTimeFilter = { gte: cutoff };
  if (params.from && DATE.test(params.from)) {
    const from = new Date(`${params.from}T00:00:00Z`);
    if (from > cutoff) createdAt.gte = from;
  }
  if (params.to && DATE.test(params.to))
    createdAt.lt = new Date(new Date(`${params.to}T00:00:00Z`).getTime() + 86_400_000);

  const documents = await db.document.findMany({
    where: {
      userId: user.id,
      createdAt,
      ...(type !== "all" ? { analyses: { some: { type } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { analyses: { orderBy: { createdAt: "desc" } } },
  });

  const selected = params.document
    ? await db.document.findFirst({
        where: { id: params.document, userId: user.id, createdAt: { gte: cutoff } },
        include: { analyses: { orderBy: { createdAt: "desc" } } },
      })
    : null;

  const label = "text-xs font-semibold uppercase tracking-wide text-gray-600";
  const field = "h-11 rounded-lg border border-gray-300 bg-white px-3";

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-gray-600">
            {t("subtitle")}{" "}
            {plan === "pro"
              ? t("retentionPro", { months: PRO_HISTORY_MONTHS })
              : t("retentionFree", { days: FREE_HISTORY_DAYS })}
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={label}>{t("type")}</span>
            <select name="type" defaultValue={type} className={field}>
              {(["all", "rewrite", "write"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`types.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>{t("from")}</span>
            <input type="date" name="from" defaultValue={params.from ?? ""} className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>{t("to")}</span>
            <input type="date" name="to" defaultValue={params.to ?? ""} className={field} />
          </label>
          <button
            type="submit"
            className="h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
          >
            {t("filter")}
          </button>
          <Link
            href="/app/historique"
            className="inline-flex h-11 items-center px-2 text-sm text-accent underline"
          >
            {t("reset")}
          </Link>
        </form>

        {documents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-gray-600">
            {t("empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[560px] text-left text-sm">
              <tbody>
                {documents.map((doc) => {
                  const analysis = doc.analyses[0];
                  const result = analysis?.resultJson as StoredResult | undefined;
                  const kind =
                    analysis?.type === "write"
                      ? t(`tools.${result?.tool ?? "outline"}`)
                      : t("types.rewrite");
                  return (
                    <tr
                      key={doc.id}
                      className={`border-b border-gray-100 last:border-0 ${selected?.id === doc.id ? "bg-accent/5" : ""}`}
                    >
                      <td className="max-w-0 truncate px-4 py-3 font-medium">{doc.title}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{kind}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">
                        {t("words", { count: doc.wordCount })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">
                        {format.dateTime(doc.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={{
                            pathname: "/app/historique",
                            query: { ...params, document: doc.id },
                          }}
                          className="inline-flex h-9 items-center rounded-lg border border-gray-300 px-3 font-medium hover:bg-gray-50"
                        >
                          {t("open")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {params.document && (
        <aside
          aria-label={t("detail")}
          className="flex flex-col gap-4 border-t border-gray-200 p-4 md:w-[380px] md:shrink-0 md:border-l md:border-t-0 md:p-5"
        >
          {!selected ? (
            <p className="text-sm text-gray-600">{t("notFound")}</p>
          ) : (
            <>
              <h2 className="font-semibold">{selected.title}</h2>
              {selected.analyses.map((analysis) => {
                const result = analysis.resultJson as StoredResult;
                if (analysis.type === "rewrite") {
                  return (result.output?.variants ?? []).map((variant, i) => (
                    <div
                      key={`${analysis.id}-${i}`}
                      className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3.5"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                        {t("variant", { n: i + 1 })} ·{" "}
                        {tr(`registers.${(result.input?.register ?? "faithful") as "academic"}`)}
                      </span>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{variant.text}</p>
                      <Link
                        href={{
                          pathname: "/app/reecrire",
                          query: { from: analysis.id, variant: String(i) },
                        }}
                        className="self-start text-sm font-semibold text-accent underline"
                      >
                        {t("openInRewrite")}
                      </Link>
                    </div>
                  ));
                }
                const output = result.output ?? {};
                return (
                  <div
                    key={analysis.id}
                    className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3.5 text-sm"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                      {t(`tools.${result.tool ?? "outline"}`)}
                    </span>
                    {output.sections && (
                      <>
                        <b>{output.title}</b>
                        <ol className="list-decimal pl-5">
                          {output.sections.map((s) => (
                            <li key={s.heading}>{s.heading}</li>
                          ))}
                        </ol>
                      </>
                    )}
                    {output.corrections && (
                      <p>{t("correctionsCount", { count: output.corrections.length })}</p>
                    )}
                    {output.summary && (
                      <p className="whitespace-pre-wrap leading-relaxed">{output.summary}</p>
                    )}
                  </div>
                );
              })}
              <Link
                href={{ pathname: "/app/historique", query: { ...params, document: undefined } }}
                className="text-sm text-accent underline"
              >
                {t("back")}
              </Link>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
