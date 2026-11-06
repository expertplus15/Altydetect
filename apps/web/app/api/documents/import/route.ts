import { auth } from "@/auth";
import { getUserPlan } from "@/lib/billing/subscription";
import { extractText, MAX_IMPORT_BYTES } from "@/lib/import/extract";

// Import PDF ou DOCX (Pro) : renvoie le texte extrait. Rien n'est stocké.
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if ((await getUserPlan(session.user.id)).plan !== "pro") {
    return Response.json({ error: "UPGRADE_REQUIRED" }, { status: 402 });
  }
  // Refus avant lecture du corps quand la taille annoncée dépasse déjà la limite.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES + 64 * 1024) {
    return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "UNSUPPORTED_TYPE" }, { status: 400 });
  }
  const result = await extractText({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) {
    const status = result.error === "FILE_TOO_LARGE" ? 413 : 422;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json(result);
}
