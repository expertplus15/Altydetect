"use client";

import { ExportPdfButton } from "@/components/rewrite/ExportPdfButton";
import { DetectScreen } from "./DetectScreen";

// Détecter dans l'espace connecté : export du rapport PDF pour Pro.
export function DetectWorkspace(props: Omit<Parameters<typeof DetectScreen>[0], "renderActions">) {
  return (
    <DetectScreen
      {...props}
      renderActions={
        props.isPro
          ? ({ analysisId, original }) => (
              <ExportPdfButton analysisId={analysisId} variantIndex={0} original={original} />
            )
          : undefined
      }
    />
  );
}
