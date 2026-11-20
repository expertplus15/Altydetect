"use client";

import { countWords } from "@altydetect/core";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

export interface EditorChange {
  text: string;
  wordCount: number;
}

/** Convertit du texte brut en paragraphes Tiptap (une ligne vide sépare deux paragraphes). */
export function textToDoc(text: string) {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: paragraph
        .split("\n")
        .flatMap((line, index) => [
          ...(index > 0 ? [{ type: "hardBreak" }] : []),
          ...(line ? [{ type: "text", text: line }] : []),
        ]),
    })),
  };
}

export function editorText(editor: TiptapEditor): string {
  return editor.getText({ blockSeparator: "\n\n" }).trim();
}

// Éditeur unique (ADR-0004) : Tiptap, collage en texte brut, compteur de mots en temps réel,
// import PDF/DOCX.
export function Editor({
  initialText = "",
  replaceText,
  onChange,
  minWords,
  canImport = false,
  onImported,
  ariaLabel,
}: {
  initialText?: string;
  /** Change le contenu depuis l'extérieur (ex. « Remplacer dans le document »). */
  replaceText?: { text: string; version: number } | null;
  onChange?: (change: EditorChange) => void;
  /** Affiche un message tant que le texte compte moins de mots. */
  minWords?: number;
  canImport?: boolean;
  onImported?: (info: { title: string; source: "pdf" | "docx" }) => void;
  ariaLabel?: string;
}) {
  const t = useTranslations("editor");
  const [words, setWords] = useState(() => countWords(initialText));
  const [importState, setImportState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "error"; message: string }
    | { kind: "done"; message: string }
  >({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        code: false,
        horizontalRule: false,
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({ placeholder: t("placeholder") }),
      CharacterCount,
    ],
    content: initialText ? textToDoc(initialText) : "",
    editorProps: {
      attributes: {
        "aria-label": ariaLabel ?? t("label"),
        "aria-multiline": "true",
        role: "textbox",
        "aria-describedby": hintId,
        "data-testid": "editor",
        class:
          "prose-alty min-h-64 w-full px-1 py-2 text-[15.5px] leading-[1.75] text-gray-900 focus:outline-none",
      },
      // Collage propre : seul le texte brut est conservé (pas de styles ni de liens copiés).
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        const { state } = view;
        const lines = text.replace(/\r\n?/g, "\n");
        if (!lines.includes("\n")) {
          view.dispatch(state.tr.insertText(lines));
          return true;
        }
        // Tranche ouverte des deux côtés : les premier et dernier paragraphes collés se fondent
        // dans le paragraphe en cours.
        const doc = state.schema.nodeFromJSON(textToDoc(lines));
        view.dispatch(state.tr.replaceSelection(new Slice(doc.content, 1, 1)).scrollIntoView());
        return true;
      },
    },
    onUpdate({ editor: current }) {
      const text = editorText(current);
      const wordCount = countWords(text);
      setWords(wordCount);
      onChangeRef.current?.({ text, wordCount });
    },
  });

  useEffect(() => {
    if (!editor || !replaceText) return;
    editor.commands.setContent(textToDoc(replaceText.text), { emitUpdate: true });
  }, [editor, replaceText]);

  async function importFile(file: File) {
    setImportState({ kind: "busy" });
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/documents/import", { method: "POST", body });
      const data = (await response.json()) as
        | { ok: true; text: string; wordCount: number; title: string; source: "pdf" | "docx" }
        | { error: string };
      if (!response.ok || !("text" in data)) {
        const code = "error" in data ? data.error : "default";
        const known = [
          "FILE_TOO_LARGE",
          "UNSUPPORTED_TYPE",
          "EMPTY_TEXT",
          "EXTRACTION_FAILED",
          "UPGRADE_REQUIRED",
          "UNAUTHENTICATED",
        ];
        setImportState({
          kind: "error",
          message: t(`importErrors.${(known.includes(code) ? code : "default") as "default"}`),
        });
        return;
      }
      editor?.commands.setContent(textToDoc(data.text), { emitUpdate: true });
      setImportState({ kind: "done", message: t("imported", { words: data.wordCount }) });
      onImported?.({ title: data.title, source: data.source });
    } catch {
      setImportState({ kind: "error", message: t("importErrors.default") });
    }
  }

  const missing = minWords !== undefined && words > 0 && words < minWords ? minWords - words : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-600">
        {canImport ? (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={importState.kind === "busy"}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 hover:bg-gray-50 disabled:opacity-60"
            >
              <Upload aria-hidden size={15} />
              {importState.kind === "busy" ? t("importing") : t("import")}
            </button>
            <span>{t("importHint")}</span>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </>
        ) : (
          <span>{t("importProOnly")}</span>
        )}
        <span className="ml-auto tabular-nums" aria-live="polite">
          <b className="text-gray-900">{t("words", { count: words })}</b>
        </span>
      </div>
      {(importState.kind === "error" || importState.kind === "done") && (
        <p
          role={importState.kind === "error" ? "alert" : "status"}
          className={`text-sm ${importState.kind === "error" ? "text-state-ai" : "text-gray-600"}`}
        >
          {importState.message}
        </p>
      )}
      <div className="rounded-xl border border-gray-200 px-5 py-4 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 md:px-8 md:py-6">
        <EditorContent editor={editor} />
      </div>
      <p id={hintId} className="min-h-5 text-[13px] text-gray-600">
        {missing > 0 ? t("minWords", { missing, min: minWords ?? 0 }) : null}
      </p>
    </div>
  );
}
