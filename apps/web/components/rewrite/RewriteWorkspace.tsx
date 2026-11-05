"use client";

import { ExportPdfButton } from "./ExportPdfButton";
import { RewriteScreen, type RewriteScreenProps } from "./RewriteScreen";

// Réécrire dans l'espace connecté : ajoute l'export PDF pour Pro.
export function RewriteWorkspace({
  isPro,
  ...props
}: Omit<RewriteScreenProps, "renderActions" | "mode"> & { isPro: boolean }) {
  return (
    <RewriteScreen
      {...props}
      mode="app"
      renderActions={
        isPro
          ? ({ analysisId, variantIndex, original }) =>
              analysisId ? (
                <ExportPdfButton
                  analysisId={analysisId}
                  variantIndex={variantIndex}
                  original={original}
                />
              ) : null
          : undefined
      }
    />
  );
}
