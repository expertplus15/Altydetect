import { MIN_WORDS_FOR_DETECTION } from "@altydetect/billing";
import { Editor } from "@/components/editor/Editor";
import { Workspace } from "@/components/shell/Workspace";
import { getUserPlan } from "@/lib/billing/subscription";
import { requireUser } from "@/lib/server/session";

// Les outils d'écriture (panneau de droite) arrivent au livrable 8.
export default async function WritePage() {
  const user = await requireUser();
  const { plan } = await getUserPlan(user.id);
  return (
    <Workspace main={<Editor canImport={plan === "pro"} minWords={MIN_WORDS_FOR_DETECTION} />} />
  );
}
