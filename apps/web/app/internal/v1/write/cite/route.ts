import { citeInputSchema, type CiteOutput } from "@altydetect/core";
import { formatCitation, metadataFromHtml, missingFields } from "@altydetect/write";
import { fetchPage } from "@/lib/write/fetch-page";
import { guardWriteTool } from "@/lib/write/guard";

export const dynamic = "force-dynamic";

// POST /internal/v1/write/cite : référence APA 7, MLA 9, Chicago ou ISO 690, à partir de
// champs structurés ou d'une URL. Mise en forme déterministe : pas d'appel au modèle, pas de quota.
export async function POST(request: Request): Promise<Response> {
  const guard = await guardWriteTool({ consumesQuota: false });
  if (!guard.ok) return guard.response;
  const parsed = citeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { style, locale, source } = parsed.data;

  let fields;
  if (source.kind === "url") {
    const page = await fetchPage(source.url);
    if (!page.ok) return Response.json({ error: page.error }, { status: 422 });
    fields = metadataFromHtml(page.html, page.url, new Date().toISOString().slice(0, 10));
  } else {
    fields = source.fields;
  }
  const output: CiteOutput = {
    citation: formatCitation(style, fields, locale),
    fields,
    missing: missingFields(fields),
  };
  return Response.json(output);
}
