"use client";

import { RewriteScreen } from "@/components/rewrite/RewriteScreen";

// Essai sans compte sur la page d'accueil : une réécriture, une proposition.
export function HomeTrial({ sample }: { sample: string }) {
  return (
    <RewriteScreen
      mode="trial"
      maxVariants={1}
      remaining={null}
      canImport={false}
      initialText={sample}
    />
  );
}
