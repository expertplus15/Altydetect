import { auth } from "@/auth";
import { getRedis } from "@/lib/server/redis";
import { pdfRedisKey } from "@/lib/reports/queue";
import { verifyReportLink } from "@/lib/reports/signed-link";

// Téléchargement d'un rapport : lien signé, expirant, réservé à son auteur.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { jobId } = await params;
  const url = new URL(request.url);
  if (
    !verifyReportLink(
      jobId,
      session.user.id,
      url.searchParams.get("expires"),
      url.searchParams.get("signature"),
    )
  ) {
    return Response.json({ error: "LINK_EXPIRED" }, { status: 410 });
  }
  const pdf = await getRedis().getBuffer(pdfRedisKey(jobId));
  if (!pdf) return Response.json({ error: "LINK_EXPIRED" }, { status: 410 });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="altydetect-reecriture-${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
