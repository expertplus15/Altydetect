"use client";

import { FileDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

// Export PDF d'une réécriture (Pro) : mise en file, attente du rapport, puis téléchargement.
// Le texte d'origine n'est envoyé que pour ce rapport et n'est pas conservé.
export function ExportPdfButton({
  analysisId,
  variantIndex,
  original,
}: {
  analysisId: string;
  variantIndex: number;
  original: string;
}) {
  const t = useTranslations("report");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "ready" | "failed">("idle");

  async function exportPdf() {
    setState("busy");
    try {
      const created = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysisId, variantIndex, original: original || null, locale }),
      });
      if (!created.ok) throw new Error("export refusé");
      const { jobId } = (await created.json()) as { jobId: string };
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 400 : 1000));
        const status = (await (await fetch(`/api/reports/${jobId}/status`)).json()) as {
          status: string;
          url?: string;
        };
        if (status.status === "ready" && status.url) {
          setState("ready");
          window.location.assign(status.url);
          return;
        }
        if (status.status === "failed") break;
      }
      setState("failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void exportPdf()}
        disabled={state === "busy"}
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-300 px-4 font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60"
      >
        <FileDown aria-hidden size={16} />
        {state === "busy" ? t("exporting") : t("export")}
      </button>
      {(state === "ready" || state === "failed") && (
        <p
          role={state === "failed" ? "alert" : "status"}
          className={`basis-full text-sm ${state === "failed" ? "text-state-ai" : "text-gray-600"}`}
        >
          {state === "failed" ? t("failed") : t("ready")}
        </p>
      )}
    </>
  );
}
