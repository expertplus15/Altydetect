import { WriteScreen } from "@/components/write/WriteScreen";
import { getUserPlan } from "@/lib/billing/subscription";
import { requireUser } from "@/lib/server/session";

export default async function WritePage() {
  const user = await requireUser();
  const { plan } = await getUserPlan(user.id);
  return <WriteScreen initialTab="outline" canImport={plan === "pro"} />;
}
