import { auth } from "@/auth";
import { reportsQueue } from "@/lib/reports/queue";
import { signedReportPath } from "@/lib/reports/signed-link";

// État d'un export PDF ; une fois prêt, renvoie un lien signé valable 15 minutes.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { jobId } = await params;
  const job = await reportsQueue().getJob(jobId);
  if (!job || job.data.userId !== session.user.id)
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  const state = await job.getState();
  if (state === "completed") {
    return Response.json({ status: "ready", url: signedReportPath(jobId, session.user.id) });
  }
  return Response.json({ status: state === "failed" ? "failed" : "pending" });
}
