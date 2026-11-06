"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";

interface Source {
  id: string;
  title: string;
  wordCount: number;
}

// Base privée (Pro) : documents de référence comparés à chaque analyse.
export function PrivateBase({
  isPro,
  editorText,
  onChange,
}: {
  isPro: boolean;
  editorText: string;
  onChange?: () => void;
}) {
  const t = useTranslations("plagiarism.base");
  const [sources, setSources] = useState<Source[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const titleId = useId();
  const textId = useId();

  const load = useCallback(async () => {
    const response = await fetch("/api/private-sources");
    if (response.ok) setSources(((await response.json()) as { sources: Source[] }).sources);
  }, []);

  useEffect(() => {
    if (isPro) void load();
  }, [isPro, load]);

  if (!isPro) return <p className="text-sm text-gray-600">{t("proOnly")}</p>;

  async function add() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/private-sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, text }),
    });
    setBusy(false);
    if (response.ok) {
      setTitle("");
      setText("");
      setMessage({ kind: "status", text: t("added") });
      await load();
      onChange?.();
    } else {
      const body = (await response.json().catch(() => ({}))) as { error?: string; max?: number };
      setMessage({
        kind: "alert",
        text: body.error === "PRIVATE_BASE_FULL" ? t("full", { max: body.max ?? 0 }) : t("failed"),
      });
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/private-sources/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setSources((list) => list.filter((s) => s.id !== id));
      onChange?.();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-gray-600">{t("intro")}</p>
      {sources.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200">
          {sources.map((source) => (
            <li key={source.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{source.title}</span>
                <span className="text-xs text-gray-600">
                  {t("words", { count: source.wordCount })}
                </span>
              </span>
              <button
                type="button"
                aria-label={t("deleteLabel", { title: source.title })}
                onClick={() => void remove(source.id)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-state-ai"
              >
                <Trash2 aria-hidden size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label
        htmlFor={titleId}
        className="text-xs font-semibold uppercase tracking-wide text-gray-600"
      >
        {t("titleLabel")}
      </label>
      <input
        id={titleId}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-11 rounded-lg border border-gray-300 px-3"
      />
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={textId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-600"
        >
          {t("textLabel")}
        </label>
        <button
          type="button"
          onClick={() => setText(editorText)}
          disabled={!editorText}
          className="text-sm text-accent underline disabled:opacity-50"
        >
          {t("fromEditor")}
        </button>
      </div>
      <textarea
        id={textId}
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={busy || !title.trim() || !text.trim()}
        onClick={() => void add()}
        className="h-11 rounded-lg bg-accent font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {t("add")}
      </button>
      {message && (
        <p
          role={message.kind}
          className={`text-sm ${message.kind === "alert" ? "text-state-ai" : "text-gray-600"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
