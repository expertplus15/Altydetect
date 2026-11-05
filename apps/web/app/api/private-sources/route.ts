import { PRO_PRIVATE_SOURCES_MAX } from "@altydetect/billing";
import { z } from "zod";
import { auth } from "@/auth";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { getIndexa } from "@/lib/plagiarism/indexa";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(400000),
});

// Base privée (Pro) : liste et ajout de documents de référence. L'espace est l'utilisateur.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const sources = await db.privateSource.findMany({
    where: { workspaceId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, wordCount: true, createdAt: true },
  });
  return Response.json({ sources });
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const userId = session.user.id;
  if ((await getUserPlan(userId)).plan !== "pro")
    return Response.json({ error: "UPGRADE_REQUIRED" }, { status: 402 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  if (
    PRO_PRIVATE_SOURCES_MAX !== null &&
    (await db.privateSource.count({ where: { workspaceId: userId } })) >= PRO_PRIVATE_SOURCES_MAX
  ) {
    return Response.json(
      { error: "PRIVATE_BASE_FULL", max: PRO_PRIVATE_SOURCES_MAX },
      { status: 409 },
    );
  }
  try {
    const source = await getIndexa().addSource({ workspace_id: userId, ...parsed.data });
    return Response.json(source, { status: 201 });
  } catch {
    return Response.json({ error: "INDEXA_UNAVAILABLE" }, { status: 502 });
  }
}
