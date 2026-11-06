import "server-only";
import { renderAnalysisReport, renderRewriteReport } from "@altydetect/reports";
import type { DetectOutput, PlagiarismOutput } from "@altydetect/core";
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

/** Libellés communs du rapport d'analyse, dans la langue demandée. */
function analysisLabels(locale: "fr" | "en") {
  const messages = locale === "en" ? en : fr;
  const t = createTranslator({ locale, messages, namespace: "report.analysis" });
  const td = createTranslator({ locale, messages, namespace: "detect" });
  return {
    t,
    td,
    labels: {
      title: t("title"),
      date: t("date"),
      timestamp: t("timestamp"),
      engine: t("engine"),
      scope: t("scope"),
      plagiarism: t("plagiarism"),
      similarity: t("similarity"),
      sources: t("sources"),
      source: t("source"),
      passages: t("passages"),
      bestScore: t("bestScore"),
      text: t("text"),
      textMissing: t("textMissing"),
      noMatch: t("noMatch"),
      detection: t("detection"),
      detectionPending: t("detectionPending"),
      disclaimer: t("disclaimer"),
      footer: "AltyDetect · altydetect.com",
    },
  };
}

/** Rapport d'une détection : répartition, résultat, confiance, phrases colorées. */
async function renderDetection(data: RewriteReportJob): Promise<Buffer | null> {
  const analysis = await db.analysis.findFirst({
    where: { id: data.analysisId, type: "detect", document: { userId: data.userId } },
  });
  if (!analysis) return null;
  const output = (analysis.resultJson as { output?: DetectOutput }).output;
  if (!output) throw new Error("Résultat de détection illisible.");
  const { t, td, labels } = analysisLabels(data.locale);
  const original = data.original;
  // Positions valables seulement pour le texte exact de l'analyse : sinon, pas de texte.
  const text =
    original && output.sentences.every((s) => s.end <= original.length) ? original : null;
  const engineName = (engine: string) => (engine.startsWith("VRT-") ? engine : td("partnerEngine"));
  const language = output.language === "fr" || output.language === "en" ? output.language : null;

  return renderAnalysisReport(
    {
      locale: data.locale,
      scopeName: null,
      engine: engineName(output.engine.primary),
      createdAt: analysis.createdAt,
      generatedAt: new Date(),
      detection: {
        overall: output.overall,
        verdictBand: output.verdict_band,
        languageName: language ? td(`languages.${language}`) : output.language,
        wordCount: output.word_count,
        text,
        sentences: output.sentences,
      },
    },
    {
      ...labels,
      detect: {
        bands: {
          likely_ai: td("bands.likely_ai"),
          undetermined: td("bands.undetermined"),
          likely_human: td("bands.likely_human"),
        },
        distribution: t("detect.distribution"),
        verdict: t("detect.verdict"),
        confidence: t("detect.confidence"),
        confidenceName: td(`confidenceLevels.${output.confidence}`),
        language: t("detect.language"),
        words: t("detect.words"),
        text: t("detect.text"),
        disclaimer: td("disclaimer"),
      },
    },
  );
}

/** Rapport combiné d'une analyse de plagiat. */
async function renderAnalysis(data: RewriteReportJob): Promise<Buffer> {
  const detection = await renderDetection(data);
  if (detection) return detection;
  const analysis = await db.analysis.findFirst({
    where: { id: data.analysisId, type: "plagiarism", document: { userId: data.userId } },
  });
  if (!analysis) throw new Error("Analyse introuvable pour cet utilisateur.");
  const stored = analysis.resultJson as {
    scope?: "web" | "private" | "both";
    output?: PlagiarismOutput;
  };
  const output = stored.output ?? { similarity: 0, matches: [], engine: analysis.engine };
  const { t, labels } = analysisLabels(data.locale);

  const docIds = [
    ...new Set(
      output.matches.map((m) => m.source_doc_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const privateSources = await db.privateSource.findMany({
    where: { id: { in: docIds }, workspaceId: data.userId },
    select: { id: true, title: true },
  });
  const titles = new Map(privateSources.map((s) => [s.id, s.title]));
  const labelOf = (m: PlagiarismOutput["matches"][number]) =>
    m.source_url ?? titles.get(m.source_doc_id ?? "") ?? t("privateDoc");
  const sources = new Map<
    string,
    { label: string; url: string | null; passages: number; bestScore: number }
  >();
  for (const m of output.matches) {
    const label = labelOf(m);
    const entry = sources.get(label) ?? {
      label,
      url: m.source_url ?? null,
      passages: 0,
      bestScore: 0,
    };
    entry.passages += 1;
    entry.bestScore = Math.max(entry.bestScore, m.score);
    sources.set(label, entry);
  }
  const original = data.original;
  // Positions valables seulement pour le texte exact de l'analyse : sinon, pas de texte.
  const text = original && output.matches.every((m) => m.end <= original.length) ? original : null;

  return renderAnalysisReport(
    {
      locale: data.locale,
      scopeName: t(`scopes.${stored.scope ?? "web"}`),
      engine: output.engine,
      createdAt: analysis.createdAt,
      generatedAt: new Date(),
      plagiarism: {
        similarity: output.similarity,
        text,
        matches: output.matches.map((m) => ({
          start: m.start,
          end: m.end,
          sourceLabel: labelOf(m),
        })),
        sources: [...sources.values()].sort((a, b) => b.passages - a.passages),
      },
    },
    labels,
  );
}

/** Génère le PDF (réécriture ou analyse) et le garde 15 minutes dans Redis. */
export async function processRewriteReport(
  jobId: string,
  data: RewriteReportJob,
): Promise<RewriteReportResult> {
  if (data.kind === "analysis") {
    const key = pdfRedisKey(jobId);
    await getRedis().set(key, await renderAnalysis(data), "EX", REPORT_LINK_TTL_SECONDS);
    return { pdfKey: key };
  }
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
