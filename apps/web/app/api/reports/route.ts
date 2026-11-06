import { z } from "zod";
import { auth } from "@/auth";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { reportsQueue } from "@/lib/reports/queue";

const bodySchema = z.object({
  analysisId: z.string().min(1).max(64),
  variantIndex: z.number().int().min(0).max(2).default(0),
  original: z.string().max(60000).nullable().default(null),
  locale: z.enum(["fr", "en"]).default("fr"),
});

// Export PDF d'une réécriture ou d'une analyse de plagiat ou de détection (Pro) : mis en file, la requête répond tout de suite (CLAUDE.md §4.9).
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if ((await getUserPlan(session.user.id)).plan !== "pro") {
    return Response.json({ error: "UPGRADE_REQUIRED" }, { status: 402 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const analysis = await db.analysis.findFirst({
    where: {
      id: parsed.data.analysisId,
      type: { in: ["rewrite", "plagiarism", "detect"] },
      document: { userId: session.user.id },
    },
    select: { type: true },
  });
  if (!analysis) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Plagiat et détection : rapport d'analyse combiné.
  const kind = analysis.type === "rewrite" ? "rewrite" : "analysis";
  const job = await reportsQueue().add(`${kind}-report`, {
    userId: session.user.id,
    kind,
    ...parsed.data,
  });
  return Response.json({ jobId: job.id }, { status: 202 });
}
