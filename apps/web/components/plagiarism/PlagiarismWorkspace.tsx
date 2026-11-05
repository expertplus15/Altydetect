"use client";

import { ExportPdfButton } from "@/components/rewrite/ExportPdfButton";
import { PlagiarismScreen } from "./PlagiarismScreen";

// Plagiat dans l'espace connecté : export du rapport PDF combiné pour Pro.
export function PlagiarismWorkspace(
  props: Omit<Parameters<typeof PlagiarismScreen>[0], "renderActions">,
) {
  return (
    <PlagiarismScreen
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
