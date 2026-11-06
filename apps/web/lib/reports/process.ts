import "server-only";
import { renderRewriteReport } from "@altydetect/reports";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/server/redis";
import { REPORT_LINK_TTL_SECONDS } from "./signed-link";
import { pdfRedisKey, type RewriteReportJob, type RewriteReportResult } from "./queue";

interface StoredRewrite {
  input?: { register?: string; intensity?: number };
  output?: { variants?: { text: string; changes_summary: string }[] };
}

/** Génère le PDF d'une réécriture et le garde 15 minutes dans Redis. */
export async function processRewriteReport(
  jobId: string,
  data: RewriteReportJob,
): Promise<RewriteReportResult> {
  const analysis = await db.analysis.findFirst({
    where: { id: data.analysisId, type: "rewrite", document: { userId: data.userId } },
  });
  if (!analysis) throw new Error("Analyse introuvable pour cet utilisateur.");
  const stored = analysis.resultJson as StoredRewrite;
  const variant = stored.output?.variants?.[data.variantIndex];
  if (!variant) throw new Error("Proposition introuvable.");

  const t = createTranslator({ locale: data.locale, messages: data.locale === "en" ? en : fr });
  const register = (stored.input?.register ?? "faithful") as "academic";
  const intensity = String(stored.input?.intensity ?? 2) as "2";
  const pdf = await renderRewriteReport(
    {
      locale: data.locale,
      original: data.original,
      proposal: variant.text,
      changesSummary: variant.changes_summary,
      registerName: t(`rewrite.registers.${register}`),
      intensityName: t(`rewrite.intensities.${intensity}`),
      createdAt: analysis.createdAt,
      generatedAt: new Date(),
    },
    {
      title: t("report.title"),
      original: t("report.original"),
      proposal: t("report.proposal"),
      register: t("rewrite.register"),
      intensity: t("rewrite.intensity"),
      date: t("report.date"),
      timestamp: t("report.timestamp"),
      originalMissing: t("report.originalMissing"),
      footer: t("report.footer"),
    },
  );
  const key = pdfRedisKey(jobId);
  await getRedis().set(key, pdf, "EX", REPORT_LINK_TTL_SECONDS);
  return { pdfKey: key };
}
