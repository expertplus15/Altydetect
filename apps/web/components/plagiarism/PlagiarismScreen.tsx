"use client";

import type { PlagiarismMatch, PlagiarismOutput, PlagiarismTask } from "@altydetect/core";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Editor } from "@/components/editor/Editor";
import { MatchedText } from "./MatchedText";
import { PrivateBase } from "./PrivateBase";

type Scope = "web" | "private" | "both";
type Run =
  | { state: "idle" }
  | { state: "running"; task: PlagiarismTask }
  | { state: "done"; result: PlagiarismOutput; analysisId: string | null }
  | { state: "error"; code: string; resetsAt?: string };

interface SourceGroup {
  key: string;
  label: string;
  url: string | null;
  matches: { match: PlagiarismMatch; index: number }[];
  best: number;
}

const KNOWN_ERRORS = [
  "TEXT_TOO_SHORT",
  "QUOTA_EXCEEDED",
  "UPGRADE_REQUIRED",
  "TEXT_TOO_LONG",
  "INDEXA_UNAVAILABLE",
];

// Écran Plagiat : éditeur (ou texte surligné après analyse) et panneau à deux onglets.
export function PlagiarismScreen({
  isPro,
  quota,
  privateTitles,
  renderActions,
}: {
  isPro: boolean;
  quota: { used: number; limit: number };
  privateTitles: Record<string, string>;
  renderActions?: ((info: { analysisId: string; original: string }) => ReactNode) | undefined;
}) {
  const t = useTranslations("plagiarism");
  const format = useFormatter();
  const router = useRouter();
  const [tab, setTab] = useState<"analysis" | "base">("analysis");
  const [scope, setScope] = useState<Scope>("web");
  const [text, setText] = useState("");
  const [analyzed, setAnalyzed] = useState("");
  const [run, setRun] = useState<Run>({ state: "idle" });
  const [active, setActive] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => void (cancelled.current = true), []);

  async function analyze() {
    setActive(null);
    setAnalyzed(text);
    const response = await fetch("/internal/v1/plagiarism", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, scope }),
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
    let task = body as unknown as PlagiarismTask;
    setRun({ state: "running", task });
    for (let attempt = 0; attempt < 300 && !cancelled.current; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 500 : 1000));
      const poll = await fetch(`/internal/v1/plagiarism/${encodeURIComponent(task.task_id)}`);
      const next = (await poll.json().catch(() => ({}))) as PlagiarismTask & {
        analysisId?: string;
        error?: string;
      };
      if (!poll.ok) {
        setRun({ state: "error", code: next.error ?? "default" });
        return;
      }
      task = next;
      if (task.status === "done" && task.result) {
        setRun({ state: "done", result: task.result, analysisId: next.analysisId ?? null });
        router.refresh();
        return;
      }
      if (task.status === "failed") {
        setRun({ state: "error", code: "FAILED" });
        router.refresh();
        return;
      }
      setRun({ state: "running", task });
    }
  }

  const groups = useMemo<SourceGroup[]>(() => {
    if (run.state !== "done") return [];
    const map = new Map<string, SourceGroup>();
    run.result.matches.forEach((match, index) => {
      const key = match.source_url ?? `doc:${match.source_doc_id ?? "?"}`;
      const label = match.source_url
        ? new URL(match.source_url).hostname.replace(/^www\./, "")
        : (privateTitles[match.source_doc_id ?? ""] ?? t("privateDoc"));
      const group = map.get(key) ?? {
        key,
        label,
        url: match.source_url ?? null,
        matches: [],
        best: 0,
      };
      group.matches.push({ match, index });
      group.best = Math.max(group.best, match.score);
      map.set(key, group);
    });
    return [...map.values()].sort((a, b) => b.matches.length - a.matches.length || b.best - a.best);
  }, [run, privateTitles, t]);

  const percent = (value: number) =>
    format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const busy = run.state === "running";
  const errorText =
    run.state === "error"
      ? run.code === "FAILED"
        ? t("status.failed")
        : t(`errors.${(KNOWN_ERRORS.includes(run.code) ? run.code : "default") as "default"}`, {
            date: run.resetsAt
              ? format.dateTime(new Date(run.resetsAt), { dateStyle: "long" })
              : "",
          })
      : null;

  const chip = (on: boolean) =>
    `h-10 rounded-full border px-3.5 text-sm disabled:opacity-50 ${on ? "border-accent bg-accent/10 font-semibold text-accent" : "border-gray-300 text-gray-900 hover:bg-gray-50"}`;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-md text-[13px] text-gray-600">{t("subtitle")}</p>
        </div>
        {run.state === "done" ? (
          <div className="flex max-w-3xl flex-col gap-3">
            <div
              className="rounded-xl border border-gray-200 px-5 py-4 md:px-8 md:py-6"
              aria-label={t("title")}
            >
              <MatchedText text={analyzed} matches={run.result.matches} activeIndex={active} />
            </div>
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
              minWords={150}
              onChange={(c) => setText(c.text)}
            />
          </div>
        )}
      </div>

      <aside
        aria-label={t("panel")}
        className="flex flex-col border-t border-gray-200 md:w-[340px] md:shrink-0 md:border-l md:border-t-0 xl:w-[380px]"
      >
        <div
          role="tablist"
          aria-label={t("panel")}
          className="grid grid-cols-2 border-b border-gray-200"
        >
          {(["analysis", "base"] as const).map((value) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`h-12 border-b-2 text-sm ${tab === value ? "border-accent font-semibold text-accent" : "border-transparent text-gray-600"}`}
            >
              {t(`tabs.${value}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-5 p-4 md:p-5">
          {tab === "base" ? (
            <PrivateBase isPro={isPro} editorText={text} onChange={() => router.refresh()} />
          ) : (
            <>
              <fieldset className="flex flex-col gap-2.5">
                <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  {t("scope")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(["web", "private", "both"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={scope === value}
                      disabled={value !== "web" && !isPro}
                      onClick={() => setScope(value)}
                      className={chip(scope === value)}
                    >
                      {t(`scopes.${value}`)}
                    </button>
                  ))}
                </div>
                {!isPro && <p className="text-[13px] text-gray-600">{t("scopePro")}</p>}
              </fieldset>
              <button
                type="button"
                disabled={busy}
                onClick={() => void analyze()}
                className="h-12 rounded-lg bg-accent text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {busy
                  ? t(`status.${run.task.status === "running" ? "running" : "queued"}`)
                  : t("analyze")}
              </button>
              {busy && (
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(run.task.progress * 100)}
                  aria-label={t("status.running")}
                  className="h-2 overflow-hidden rounded-full bg-gray-200"
                >
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.max(5, run.task.progress * 100)}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-gray-600">
                {t("quota", { used: format.number(quota.used), limit: format.number(quota.limit) })}
              </p>
              {errorText && (
                <p role="alert" className="text-sm text-state-ai">
                  {errorText}
                </p>
              )}

              {run.state === "done" && (
                <section aria-label={t("status.done")} className="flex flex-col gap-4">
                  <div className="flex items-end justify-between gap-3 border-t border-gray-200 pt-4">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                        {t("similarity")}
                      </span>
                      <span className="text-4xl font-bold tabular-nums">
                        {percent(run.result.similarity)}
                      </span>
                      <span className="text-xs text-gray-600">{t("similarityHint")}</span>
                    </div>
                    <span className="text-sm text-gray-600">
                      {t("sources", { count: groups.length })}
                    </span>
                  </div>
                  {groups.length === 0 ? (
                    <p className="text-sm text-gray-600">{t("noMatch")}</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {groups.map((group) => (
                        <li
                          key={group.key}
                          className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3.5"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            {group.url ? (
                              <a
                                href={group.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate font-semibold text-accent underline"
                              >
                                {group.label}
                              </a>
                            ) : (
                              <span className="truncate font-semibold">{group.label}</span>
                            )}
                            <span className="shrink-0 text-xs text-gray-600">
                              {t("passages", { count: group.matches.length })}
                            </span>
                          </div>
                          {group.matches.map(({ match, index }) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => {
                                setActive(index);
                                document
                                  .getElementById(`match-${index}`)
                                  ?.scrollIntoView({ block: "center" });
                              }}
                              className={`flex flex-col gap-1 rounded-lg p-2 text-left text-[13px] hover:bg-gray-50 ${active === index ? "bg-state-ai/10" : ""}`}
                            >
                              <span className="line-clamp-3 text-gray-800">
                                « {match.excerpt} »
                              </span>
                              <span className="text-xs text-gray-600">
                                {t("score", { score: Math.round(match.score * 100) })}
                              </span>
                            </button>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                  {run.analysisId &&
                    renderActions?.({ analysisId: run.analysisId, original: analyzed })}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
