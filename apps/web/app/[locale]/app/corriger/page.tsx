import { WriteScreen } from "@/components/write/WriteScreen";
import { getUserPlan } from "@/lib/billing/subscription";
import { requireUser } from "@/lib/server/session";

export default async function CorrectPage() {
  const user = await requireUser();
  const { plan } = await getUserPlan(user.id);
  return <WriteScreen initialTab="correct" canImport={plan === "pro"} />;
}
