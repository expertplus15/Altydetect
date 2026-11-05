import { TrialClaim } from "@/components/trial/TrialClaim";
import { Workspace } from "@/components/shell/Workspace";

// Écran Réécrire : construit au livrable 7.
export default function RewritePage() {
  return <Workspace main={<TrialClaim />} />;
}
