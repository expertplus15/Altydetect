"use client";

import {
  DETECT_MIN_WORDS,
  VERDICT_BANDS,
  type DetectOutput,
  type SentenceScore,
  type VerdictBand,
} from "@altydetect/core";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Editor } from "@/components/editor/Editor";
import { BAND_STYLES, SentenceText } from "./SentenceText";

type Language = "auto" | "fr" | "en";
type Mode = "standard" | "deep";
type Run =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; result: DetectOutput; analysisId: string | null }
  | { state: "error"; code: string; resetsAt?: string };

const KNOWN_ERRORS = [
  "TEXT_TOO_SHORT",
  "QUOTA_EXCEEDED",
  "UPGRADE_REQUIRED",
  "TEXT_TOO_LONG",
  "DETECTION_UNAVAILABLE",
];
const SHARE_KEY = { likely_ai: "ai", undetermined: "undetermined", likely_human: "human" } as const;

/** Les références Veritas sont affichées ; un fournisseur externe reste « moteur partenaire ». */
export function isVeritasEngine(engine: string): boolean {
  return engine.startsWith("VRT-");
}

// Écran Détecter : éditeur (ou texte coloré par phrase après analyse) et panneau de résultat.
// Le résultat est une probabilité avec confiance et zone « Indéterminé », jamais un verdict.
export function DetectScreen({
  isPro,
  quota,
  renderActions,
}: {
  isPro: boolean;
  quota: { used: number; limit: number };
  renderActions?: ((info: { analysisId: string; original: string }) => ReactNode) | undefined;
}) {
  const t = useTranslations("detect");
  const format = useFormatter();
  const router = useRouter();
  const [text, setText] = useState("");
  const [analyzed, setAnalyzed] = useState("");
  const [language, setLanguage] = useState<Language>("auto");
  const [mode, setMode] = useState<Mode>("standard");
  const [keepText, setKeepText] = useState(false);
  const [run, setRun] = useState<Run>({ state: "idle" });

  const percent = (value: number) =>
    format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const bandName = (band: VerdictBand) => t(`bands.${band}`);
  const engineName = (engine: string) => (isVeritasEngine(engine) ? engine : t("partnerEngine"));

  async function analyze() {
    setAnalyzed(text);
    setRun({ state: "running" });
    try {
      const response = await fetch("/internal/v1/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, language, mode, keep_text: keepText }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setRun({
          state: "error",
          code: typeof body.error === "string" ? body.error : "default",
          ...(typeof body.resetsAt === "string" ? { resetsAt: body.resetsAt } : {}),
        });
        return;
      }
      const { analysisId, ...result } = body as DetectOutput & { analysisId?: string | null };
      setRun({ state: "done", result, analysisId: analysisId ?? null });
      router.refresh();
    } catch {
      setRun({ state: "error", code: "default" });
    }
  }

  const busy = run.state === "running";
  const errorText =
    run.state === "error"
      ? t(`errors.${(KNOWN_ERRORS.includes(run.code) ? run.code : "default") as "default"}`, {
          date: run.resetsAt ? format.dateTime(new Date(run.resetsAt), { dateStyle: "long" }) : "",
        })
      : null;
  const chip = (on: boolean) =>
    `h-11 rounded-full border px-3.5 text-sm disabled:opacity-50 ${on ? "border-accent bg-accent/10 font-semibold text-accent" : "border-gray-300 text-gray-900 hover:bg-gray-50"}`;
  const label = "text-xs font-semibold uppercase tracking-wide text-gray-600";

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-md text-[13px] text-gray-600">{t("subtitle")}</p>
        </div>
        {run.state === "done" ? (
          <div className="flex max-w-3xl flex-col gap-3">
            <section
              aria-label={t("textLabel")}
              className="rounded-xl border border-gray-200 px-5 py-4 md:px-8 md:py-6"
            >
              <SentenceText
                text={analyzed}
                sentences={run.result.sentences}
                bandName={bandName}
                describe={(s: SentenceScore) =>
                  t("sentence", { band: bandName(s.band), score: percent(s.score) })
                }
              />
            </section>
            <button
              type="button"
              onClick={() => setRun({ state: "idle" })}
              className="h-11 self-start rounded-lg border border-gray-300 px-4 font-medium hover:bg-gray-50"
            >
              {t("edit")}
            </button>
          </div>
        ) : (
          <div className="max-w-3xl">
            <Editor
              initialText={analyzed}
              canImport={isPro}
              minWords={DETECT_MIN_WORDS}
              onChange={(c) => setText(c.text)}
            />
          </div>
        )}
      </div>

      <aside
        aria-label={t("panel")}
        className="flex flex-col gap-5 border-t border-gray-200 p-4 md:w-[340px] md:shrink-0 md:border-l md:border-t-0 md:p-5 xl:w-[380px]"
      >
        <fieldset className="flex flex-col gap-2.5">
          <legend className={`mb-2.5 ${label}`}>{t("language")}</legend>
          <div className="flex flex-wrap gap-2">
            {(["auto", "fr", "en"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={language === value}
                onClick={() => setLanguage(value)}
                className={chip(language === value)}
              >
                {t(`languages.${value}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2.5">
          <legend className={`mb-2.5 ${label}`}>{t("mode")}</legend>
          <div className="flex flex-wrap gap-2">
            {(["standard", "deep"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={value === "deep" && !isPro}
                onClick={() => setMode(value)}
                className={chip(mode === value)}
              >
                {t(`modes.${value}`)}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-gray-600">{t("deepHint")}</p>
        </fieldset>
        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={keepText}
            onChange={(event) => setKeepText(event.target.checked)}
            className="h-5 w-5 accent-accent"
          />
          {t("keepText")}
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void analyze()}
          className="h-12 rounded-lg bg-accent text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? t("analyzing") : t("analyze")}
        </button>
        <p className="text-xs text-gray-600">
          {t("quota", { used: format.number(quota.used), limit: format.number(quota.limit) })}
        </p>
        {errorText && (
          <p role="alert" className="text-sm text-state-ai">
            {errorText}
          </p>
        )}

        {run.state === "done" && (
          <section aria-label={t("result")} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 border-t border-gray-200 pt-4">
              <span className={label}>{t("result")}</span>
              <span
                data-testid="verdict-band"
                className={`text-[28px] font-bold leading-tight ${BAND_STYLES[run.result.verdict_band].text}`}
              >
                {bandName(run.result.verdict_band)}
              </span>
              <span className="text-sm text-gray-700">
                {t("confidence", { level: t(`confidenceLevels.${run.result.confidence}`) })}
              </span>
              {run.result.confidence === "low" && (
                <p className="text-[13px] text-gray-600">{t("lowConfidence")}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className={label}>{t("distribution")}</span>
              <div className="flex h-3 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                {VERDICT_BANDS.map((band) => (
                  <div
                    key={band}
                    className={BAND_STYLES[band].bar}
                    style={{ width: `${run.result.overall[SHARE_KEY[band]] * 100}%` }}
                  />
                ))}
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {VERDICT_BANDS.map((band) => (
                  <li key={band} className="flex items-center gap-2">
                    <span aria-hidden className={`h-3 w-3 rounded-sm ${BAND_STYLES[band].bar}`} />
                    {t("share", {
                      band: bandName(band),
                      share: percent(run.result.overall[SHARE_KEY[band]]),
                    })}
                  </li>
                ))}
              </ul>
            </div>

            <p
              data-testid="detect-disclaimer"
              className="rounded-lg bg-gray-50 p-3 text-[13px] leading-relaxed text-gray-700"
            >
              {t("disclaimer")}
            </p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-gray-600">{t("engine")}</dt>
              <dd>{engineName(run.result.engine.primary)}</dd>
              {run.result.engine.secondary && (
                <>
                  <dt className="text-gray-600">{t("secondEngine")}</dt>
                  <dd>{engineName(run.result.engine.secondary)}</dd>
                </>
              )}
              {run.result.engine.agreement !== undefined && (
                <>
                  <dt className="text-gray-600">{t("agreement")}</dt>
                  <dd>{percent(run.result.engine.agreement)}</dd>
                </>
              )}
              <dt className="text-gray-600">{t("languageDetected")}</dt>
              <dd>
                {run.result.language === "fr" || run.result.language === "en"
                  ? t(`languages.${run.result.language}`)
                  : run.result.language}
              </dd>
              <dt className="text-gray-600">{t("length")}</dt>
              <dd>{t("words", { count: run.result.word_count })}</dd>
              {run.result.signals.probable_model && (
                <>
                  <dt className="text-gray-600">{t("probableModel")}</dt>
                  <dd>{run.result.signals.probable_model}</dd>
                </>
              )}
            </dl>
            {run.analysisId && renderActions?.({ analysisId: run.analysisId, original: analyzed })}
          </section>
        )}
      </aside>
    </div>
  );
}
