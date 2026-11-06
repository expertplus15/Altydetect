import { auth } from "@/auth";
import { getIndexa } from "@/lib/plagiarism/indexa";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { sourceId } = await params;
  try {
    await getIndexa().deleteSource(session.user.id, sourceId);
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}
