import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

// /app ouvre le premier outil disponible.
export default async function WorkspaceHome() {
  return redirect({ href: "/app/reecrire", locale: await getLocale() });
}
