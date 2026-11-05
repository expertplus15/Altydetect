import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/server/session";

// Espace connecté : session vérifiée côté serveur à chaque requête.
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <AppShell>{children}</AppShell>;
}
