"use client";

import {
  CITATION_STYLES,
  SUMMARY_LENGTHS,
  WRITE_LEVELS,
  type CitationFields,
  type CitationStyle,
  type CiteOutput,
  type Correction,
  type CorrectOutput,
  type OutlineOutput,
  type SummarizeOutput,
} from "@altydetect/core";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Editor } from "@/components/editor/Editor";
import { Italic } from "./Italic";
import { KNOWN_WRITE_ERRORS, postJson } from "./postJson";

type Tab = "outline" | "correct" | "cite" | "summarize";
const TABS: Tab[] = ["outline", "correct", "cite", "summarize"];

/** Applique une correction au texte, en supposant qu'il n'a pas changé depuis l'analyse. */
function applyOne(text: string, c: Correction): string {
  return text.slice(0, c.start) + c.replacement + text.slice(c.end);
}

// Écran Écrire : éditeur central, quatre outils en onglets dans le panneau de droite.
export function WriteScreen({ initialTab, canImport }: { initialTab: Tab; canImport: boolean }) {
  const t = useTranslations("write");
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState<{ text: string; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { subject: useId(), level: useId(), url: useId() };

  // Résultats par outil
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState<(typeof WRITE_LEVELS)[number]>("bachelor");
  const [outline, setOutline] = useState<OutlineOutput | null>(null);
  const [corrections, setCorrections] = useState<{ text: string; items: Correction[] } | null>(
    null,
  );
  const [length, setLength] = useState<(typeof SUMMARY_LENGTHS)[number]>("short");
  const [summary, setSummary] = useState<string | null>(null);
  const [style, setStyle] = useState<CitationStyle>("apa7");
  const [citeFrom, setCiteFrom] = useState<"url" | "fields">("url");
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState<Omit<CitationFields, "authors"> & { authors: string }>({
    type: "article",
    authors: "",
    title: "",
    year: "",
    container: "",
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
    url: "",
    doi: "",
    accessed: "",
  });
  const [citation, setCitation] = useState<CiteOutput | null>(null);

  function setDocument(value: string) {
    setReplace({ text: value, version: Date.now() });
  }

  async function call<T>(
    path: string,
    body: unknown,
    onData: (data: T) => void,
    needsText = false,
  ) {
    if (needsText && !text.trim()) {
      setError(t("needText"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await postJson<T>(path, body);
    setBusy(false);
    if (!result.ok) {
      setError(
        t(
          `errors.${(KNOWN_WRITE_ERRORS.includes(result.error) ? result.error : "default") as "default"}`,
        ),
      );
      return;
    }
    onData(result.data);
    router.refresh();
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value.replace(/\*([^*]+)\*/g, "$1"));
      setNotice(t("copied"));
    } catch {
      setNotice(null);
    }
  }

  const stale = corrections !== null && corrections.text !== text;
  const primary =
    "h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90 disabled:opacity-60";
  const secondary =
    "h-11 rounded-lg border border-gray-300 px-4 font-medium text-gray-900 hover:bg-gray-50";
  const chip = (on: boolean) =>
    `h-10 rounded-full border px-3.5 text-sm ${on ? "border-accent bg-accent/10 font-semibold text-accent" : "border-gray-300 text-gray-900 hover:bg-gray-50"}`;
  const label = "text-xs font-semibold uppercase tracking-wide text-gray-600";
  const input = "h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-[15px]";

  const panels: Record<Tab, ReactNode> = {
    outline: (
      <div className="flex flex-col gap-4">
        <label htmlFor={ids.subject} className={label}>
          {t("outline.subject")}
        </label>
        <input
          id={ids.subject}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("outline.subjectPlaceholder")}
          className={input}
        />
        <label htmlFor={ids.level} className={label}>
          {t("outline.level")}
        </label>
        <select
          id={ids.level}
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
          className={input}
        >
          {WRITE_LEVELS.map((value) => (
            <option key={value} value={value}>
              {t(`outline.levels.${value}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || subject.trim().length < 3}
          className={primary}
          onClick={() =>
            void call<OutlineOutput>(
              "/internal/v1/write/outline",
              { subject, level, language: "auto" },
              setOutline,
            )
          }
        >
          {busy ? t("running") : t("outline.generate")}
        </button>
        {outline && (
          <div className="flex flex-col gap-3 rounded-lg bg-gray-50 p-4">
            <h3 className="font-semibold">{outline.title}</h3>
            <ol className="flex list-decimal flex-col gap-2 pl-5">
              {outline.sections.map((section) => (
                <li key={section.heading}>
                  <span className="font-medium">{section.heading}</span>
                  <ul className="list-disc pl-5 text-sm text-gray-700">
                    {section.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={secondary}
              onClick={() => {
                setDocument(
                  [
                    outline.title,
                    ...outline.sections.map(
                      (s) => `${s.heading}\n${s.points.map((p) => `– ${p}`).join("\n")}`,
                    ),
                  ].join("\n\n"),
                );
                setNotice(t("inserted"));
              }}
            >
              {t("outline.insert")}
            </button>
          </div>
        )}
      </div>
    ),
    correct: (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          disabled={busy}
          className={primary}
          onClick={() =>
            void call<CorrectOutput>(
              "/internal/v1/write/correct",
              { text },
              (data) => setCorrections({ text, items: data.corrections }),
              true,
            )
          }
        >
          {busy ? t("running") : t("correct.check")}
        </button>
        {corrections && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <b>
                {corrections.items.length
                  ? t("correct.count", { count: corrections.items.length })
                  : t("correct.none")}
              </b>
              {corrections.items.length > 0 && !stale && (
                <button
                  type="button"
                  className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white"
                  onClick={() => {
                    const next = [...corrections.items]
                      .sort((a, b) => b.start - a.start)
                      .reduce(applyOne, corrections.text);
                    setDocument(next);
                    setCorrections({ text: next, items: [] });
                  }}
                >
                  {t("correct.acceptAll")}
                </button>
              )}
            </div>
            {stale && <p className="text-sm text-gray-600">{t("correct.stale")}</p>}
            {corrections.items.map((c, i) => (
              <div
                key={`${c.start}-${i}`}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3.5"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-state-ai">
                  {t(`correct.kinds.${c.kind}`)}
                </span>
                <span>
                  <s className="text-gray-600">{c.original}</s> → <b>{c.replacement}</b>
                </span>
                <span className="text-[13px] leading-relaxed text-gray-600">{c.explanation}</span>
                {!stale && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-lg border border-accent bg-accent/10 px-3 text-sm font-semibold text-accent"
                      onClick={() => {
                        const next = applyOne(corrections.text, c);
                        const delta = c.replacement.length - (c.end - c.start);
                        setDocument(next);
                        setCorrections({
                          text: next,
                          items: corrections.items
                            .filter((x) => x !== c)
                            .map((x) =>
                              x.start > c.start
                                ? { ...x, start: x.start + delta, end: x.end + delta }
                                : x,
                            ),
                        });
                      }}
                    >
                      {t("correct.accept")}
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-lg border border-gray-300 px-3 text-sm"
                      onClick={() =>
                        setCorrections({
                          ...corrections,
                          items: corrections.items.filter((x) => x !== c),
                        })
                      }
                    >
                      {t("correct.ignore")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    cite: (
      <div className="flex flex-col gap-4">
        <span className={label}>{t("cite.style")}</span>
        <div className="flex flex-wrap gap-2">
          {CITATION_STYLES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={style === value}
              className={chip(style === value)}
              onClick={() => setStyle(value)}
            >
              {{ apa7: "APA 7", mla9: "MLA 9", chicago: "Chicago", iso690: "ISO 690" }[value]}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label={t("cite.from")}
          className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1"
        >
          {(["url", "fields"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={citeFrom === value}
              onClick={() => setCiteFrom(value)}
              className={`h-9 rounded-md text-sm ${citeFrom === value ? "bg-white font-semibold shadow-sm" : "text-gray-600"}`}
            >
              {value === "url" ? t("cite.fromUrl") : t("cite.fromFields")}
            </button>
          ))}
        </div>
        {citeFrom === "url" ? (
          <>
            <label htmlFor={ids.url} className={label}>
              {t("cite.url")}
            </label>
            <input
              id={ids.url}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://doi.org/…"
              className={input}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              {t("cite.type")}
              <select
                value={fields.type}
                onChange={(e) =>
                  setFields({ ...fields, type: e.target.value as CitationFields["type"] })
                }
                className={input}
              >
                {(["article", "book", "web"] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`cite.types.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              {t("cite.authors")}
              <textarea
                rows={2}
                value={fields.authors}
                onChange={(e) => setFields({ ...fields, authors: e.target.value })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-[15px]"
              />
              <span className="text-xs text-gray-600">{t("cite.authorsHint")}</span>
            </label>
            {(
              [
                "title",
                "year",
                "container",
                "volume",
                "issue",
                "pages",
                "publisher",
                "doi",
                "url",
                "accessed",
              ] as const
            ).map((key) => (
              <label key={key} className="flex flex-col gap-1.5 text-sm">
                {key === "title"
                  ? t("cite.titleField")
                  : key === "url"
                    ? t("cite.url")
                    : t(`cite.${key}`)}
                <input
                  type={key === "accessed" ? "date" : "text"}
                  value={fields[key]}
                  onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                  className={input}
                />
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={busy}
          className={primary}
          onClick={() => {
            const source =
              citeFrom === "url"
                ? {
                    kind: "url",
                    url: url.trim().startsWith("10.")
                      ? `https://doi.org/${url.trim()}`
                      : url.trim(),
                  }
                : {
                    kind: "fields",
                    fields: {
                      ...fields,
                      authors: fields.authors
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line) => {
                          const [family = "", given = ""] = line.split(",", 2);
                          return { family: family.trim(), given: given.trim() };
                        }),
                    },
                  };
            void call<CiteOutput>(
              "/internal/v1/write/cite",
              { style, locale, source },
              setCitation,
            );
          }}
        >
          {busy ? t("running") : t("cite.generate")}
        </button>
        {citation && (
          <div className="flex flex-col gap-3 rounded-lg bg-gray-50 p-4">
            <p className="text-[15px] leading-relaxed">
              <Italic text={citation.citation} />
            </p>
            {citation.missing.length > 0 && (
              <p className="text-sm text-gray-600">
                {t("cite.missing", {
                  fields: citation.missing
                    .map((f) => t(`cite.fieldNames.${f as "authors"}`))
                    .join(", "),
                })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={secondary}
                onClick={() => void copy(citation.citation)}
              >
                {t("copy")}
              </button>
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  setDocument(
                    `${text}${text ? "\n\n" : ""}${citation.citation.replace(/\*([^*]+)\*/g, "$1")}`,
                  );
                  setNotice(t("inserted"));
                }}
              >
                {t("insert")}
              </button>
            </div>
          </div>
        )}
      </div>
    ),
    summarize: (
      <div className="flex flex-col gap-4">
        <span className={label}>{t("summarize.length")}</span>
        <div className="grid grid-cols-3 gap-1.5">
          {SUMMARY_LENGTHS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={length === value}
              className={chip(length === value)}
              onClick={() => setLength(value)}
            >
              {t(`summarize.lengths.${value}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          className={primary}
          onClick={() =>
            void call<SummarizeOutput>(
              "/internal/v1/write/summarize",
              { text, length },
              (data) => setSummary(data.summary),
              true,
            )
          }
        >
          {busy ? t("running") : t("summarize.generate")}
        </button>
        {summary && (
          <div className="flex flex-col gap-3 rounded-lg bg-gray-50 p-4">
            <p className="whitespace-pre-wrap leading-relaxed">{summary}</p>
            <button type="button" className={secondary} onClick={() => void copy(summary)}>
              {t("copy")}
            </button>
          </div>
        )}
      </div>
    ),
  };

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <h1 className="text-[22px] font-semibold tracking-tight">
          {initialTab === "correct" ? t("correctTitle") : t("title")}
        </h1>
        <div className="max-w-3xl">
          <Editor
            replaceText={replace}
            canImport={canImport}
            onChange={(change) => setText(change.text)}
          />
        </div>
      </div>
      <aside
        aria-label={t("tools")}
        className="flex flex-col border-t border-gray-200 md:w-[340px] md:shrink-0 md:border-l md:border-t-0 xl:w-[380px]"
      >
        <div
          role="tablist"
          aria-label={t("tools")}
          className="grid grid-cols-4 border-b border-gray-200"
        >
          {TABS.map((value) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value);
                setError(null);
                setNotice(null);
              }}
              className={`h-12 border-b-2 text-sm ${tab === value ? "border-accent font-semibold text-accent" : "border-transparent text-gray-600 hover:text-gray-900"}`}
            >
              {t(`tabs.${value}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-4 p-4 md:p-5">
          {panels[tab]}
          {(error || notice) && (
            <p
              role={error ? "alert" : "status"}
              className={`text-sm ${error ? "text-state-ai" : "text-gray-600"}`}
            >
              {error ?? notice}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
