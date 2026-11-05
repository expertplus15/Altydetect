"use client";

import { REWRITE_REGISTERS, type RewriteRegister } from "@altydetect/core";
import { ChevronLeft, ChevronRight, Copy, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Editor, type EditorChange } from "@/components/editor/Editor";
import { Link } from "@/i18n/navigation";
import { Highlighted } from "./Highlighted";
import { useRewrite } from "./useRewrite";

export interface RewriteScreenProps {
  mode: "app" | "trial";
  /** Propositions autorisées par le plan (1 en Gratuit et en essai, 3 en Pro). */
  maxVariants: number;
  /** Réécritures restantes aujourd'hui ; null quand la limite n'est pas affichée (Pro). */
  remaining: number | null;
  canImport: boolean;
  initialText?: string;
  /** Actions supplémentaires sous la proposition (ex. export PDF). */
  renderActions?: (info: {
    documentId: string | null;
    variantIndex: number;
    original: string;
  }) => ReactNode;
}

// Écran Réécrire (maquette « Réécrire ») : original à gauche, proposition à droite, réglages dans
// le panneau. Le texte n'est envoyé qu'à la route interne /internal/v1/rewrite.
export function RewriteScreen({
  mode,
  maxVariants,
  remaining: initialRemaining,
  canImport,
  initialText = "",
  renderActions,
}: RewriteScreenProps) {
  const t = useTranslations("rewrite");
  const { state, run, stop } = useRewrite();
  const [text, setText] = useState(initialText);
  const [register, setRegister] = useState<RewriteRegister>("academic");
  const [intensity, setIntensity] = useState<1 | 2 | 3>(2);
  const [preserve, setPreserve] = useState(true);
  const [variants, setVariants] = useState(maxVariants);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [replace, setReplace] = useState<{ text: string; version: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const intensityId = useId();
  const variantsId = useId();

  const shown = state.status === "streaming" || state.status === "done" ? state.variants : [];
  const current = shown[Math.min(index, Math.max(0, shown.length - 1))];
  const streaming = state.status === "streaming";

  // Décompte local des réécritures restantes à chaque réécriture terminée.
  // et rafraîchissement des documents récents de la barre latérale.
  const router = useRouter();
  const finished = state.status === "done";
  useEffect(() => {
    if (!finished) return;
    setRemaining((value) => (value === null ? null : Math.max(0, value - 1)));
    if (mode === "app") router.refresh();
  }, [finished, mode, router]);

  function submit() {
    if (!text.trim()) {
      setNotice(t("needText"));
      return;
    }
    setNotice(null);
    setIndex(0);
    void run({ text, register, intensity, preserve_citations: preserve, variants });
  }

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      setNotice(t("copied"));
    } catch {
      setNotice(null);
    }
  }

  const errorMessage = (() => {
    if (state.status !== "error") return null;
    const code =
      state.code === "QUOTA_EXCEEDED" && remaining === null ? "QUOTA_EXCEEDED_PRO" : state.code;
    const known = [
      "QUOTA_EXCEEDED",
      "QUOTA_EXCEEDED_PRO",
      "SIGN_UP_REQUIRED",
      "TRIAL_LIMIT",
      "TEXT_TOO_LONG",
      "REFUSED",
      "INVALID_INPUT",
    ];
    const key = (known.includes(code) ? code : "default") as "default";
    return t(`errors.${key}`, { maxWords: Number(state.details.maxWords ?? 0) });
  })();
  const needsAccount =
    state.status === "error" && (state.code === "SIGN_UP_REQUIRED" || state.code === "TRIAL_LIMIT");
  const needsPro =
    state.status === "error" &&
    state.code === "QUOTA_EXCEEDED" &&
    remaining !== null &&
    mode === "app";

  const editor = (
    <section aria-label={t("original")} className="flex min-w-0 flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {t("original")}
      </h2>
      <Editor
        initialText={initialText}
        replaceText={replace}
        canImport={canImport}
        onChange={(change: EditorChange) => setText(change.text)}
      />
    </section>
  );

  const proposition = (
    <section
      aria-label={t("propositionSingle")}
      aria-busy={streaming}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-accent p-4 shadow-[0_0_0_3px_rgba(29,78,216,0.08)] md:p-5"
    >
      <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
        <span>
          {shown.length > 1
            ? t("proposition", {
                current: Math.min(index, shown.length - 1) + 1,
                total: shown.length,
              })
            : t("propositionSingle")}
        </span>
        {shown.length > 1 && (
          <span className="flex gap-1">
            <button
              type="button"
              aria-label={t("previous")}
              onClick={() => setIndex((i) => (i + shown.length - 1) % shown.length)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-900 hover:bg-gray-50"
            >
              <ChevronLeft aria-hidden size={16} />
            </button>
            <button
              type="button"
              aria-label={t("next")}
              onClick={() => setIndex((i) => (i + 1) % shown.length)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-900 hover:bg-gray-50"
            >
              <ChevronRight aria-hidden size={16} />
            </button>
          </span>
        )}
      </div>
      <div
        className="min-h-40 whitespace-pre-wrap text-[15.5px] leading-[1.75] text-gray-900"
        aria-live="polite"
      >
        {current?.text ? (
          <Highlighted text={current.text} enabled={preserve} />
        ) : (
          <span className="text-gray-600">{streaming ? t("writing") : t("empty")}</span>
        )}
      </div>
      {current?.changes_summary && (
        <p className="border-t border-dashed border-gray-200 pt-2.5 text-[13px] text-gray-600">
          {current.changes_summary}
        </p>
      )}
      {state.status === "done" && current && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-300 px-4 font-medium text-gray-900 hover:bg-gray-50"
          >
            <Copy aria-hidden size={16} />
            {t("copy")}
          </button>
          <button
            type="button"
            onClick={() => {
              setReplace({ text: current.text, version: Date.now() });
              setNotice(t("replaced"));
            }}
            className="inline-flex h-11 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90"
          >
            {t("replace")}
          </button>
          {renderActions?.({ documentId: state.documentId, variantIndex: index, original: text })}
        </div>
      )}
      {state.status === "done" && state.trial && (
        <p className="flex flex-wrap items-center gap-3 rounded-lg bg-accent/5 p-3 text-sm text-gray-800">
          {t("trialSaved")}
          <Link href="/inscription" className="font-semibold text-accent underline">
            {t("signUp")}
          </Link>
        </p>
      )}
    </section>
  );

  const settings = (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
          {t("register")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {REWRITE_REGISTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={register === value}
              onClick={() => setRegister(value)}
              className={`h-10 rounded-full border px-3.5 text-sm ${
                register === value
                  ? "border-accent bg-accent/10 font-semibold text-accent"
                  : "border-gray-300 text-gray-900 hover:bg-gray-50"
              }`}
            >
              {t(`registers.${value}`)}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-gray-600">{t(`registerHints.${register}`)}</p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label
          htmlFor={intensityId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-600"
        >
          {t("intensity")} · {t(`intensities.${intensity}`)}
        </label>
        <input
          id={intensityId}
          type="range"
          min={1}
          max={3}
          step={1}
          value={intensity}
          aria-valuetext={t(`intensities.${intensity}`)}
          onChange={(event) => setIntensity(Number(event.target.value) as 1 | 2 | 3)}
          className="h-7 w-full accent-accent"
        />
        <div className="flex justify-between text-xs text-gray-600" aria-hidden>
          <span>{t("intensities.1")}</span>
          <span>{t("intensities.2")}</span>
          <span>{t("intensities.3")}</span>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={preserve}
          onChange={(event) => setPreserve(event.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] accent-accent"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t("preserve")}</span>
          <span className="text-[13px] text-gray-600">{t("preserveHint")}</span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <label
          htmlFor={variantsId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-600"
        >
          {t("variants")}
        </label>
        <select
          id={variantsId}
          value={variants}
          disabled={maxVariants <= 1}
          onChange={(event) => setVariants(Number(event.target.value))}
          className="h-11 rounded-lg border border-gray-300 bg-white px-2.5 disabled:bg-gray-50 disabled:text-gray-600"
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n} disabled={n > maxVariants}>
              {n}
            </option>
          ))}
        </select>
        {maxVariants <= 1 && <p className="text-[13px] text-gray-600">{t("variantsPro")}</p>}
      </div>

      {streaming ? (
        <button
          type="button"
          onClick={stop}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-gray-300 font-semibold text-gray-900 hover:bg-gray-50"
        >
          <Square aria-hidden size={14} />
          {t("stop")}
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          className="h-12 rounded-lg bg-accent text-[15px] font-semibold text-white hover:opacity-90"
        >
          {t("submit")}
        </button>
      )}
      {remaining !== null && mode === "app" && (
        <p className="text-xs text-gray-600">{t("remaining", { count: remaining })}</p>
      )}
      {(errorMessage || notice) && (
        <div
          role={errorMessage ? "alert" : "status"}
          className={`flex flex-col gap-2 text-sm ${errorMessage ? "text-state-ai" : "text-gray-600"}`}
        >
          <p>{errorMessage ?? notice}</p>
          {needsAccount && (
            <Link href="/inscription" className="font-semibold text-accent underline">
              {t("signUp")}
            </Link>
          )}
          {needsPro && (
            <Link href="/tarifs" className="font-semibold text-accent underline">
              {t("upgrade")}
            </Link>
          )}
        </div>
      )}
    </div>
  );

  // Sous 768 px, le panneau de réglages passe sous l'éditeur (CLAUDE.md §8).
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-[13px] text-gray-600">{t("subtitle")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {editor}
          {proposition}
        </div>
      </div>
      <aside
        aria-label={t("settings")}
        className="border-t border-gray-200 p-4 md:w-[340px] md:shrink-0 md:border-l md:border-t-0 md:p-5 xl:w-[380px]"
      >
        {settings}
      </aside>
    </div>
  );
}
