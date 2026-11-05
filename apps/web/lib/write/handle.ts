import "server-only";
import { WriteError, type WriteResult } from "@altydetect/write";
import { releaseRewriteRequest } from "@/lib/billing/quota-release";
import { db } from "@/lib/db";
import { documentTitle } from "@/lib/server/document-title";
import { guardWriteTool } from "./guard";

/**
 * Déroulé commun des outils Écrire qui appellent le modèle : contrôle d'accès et de quota,
 * appel, enregistrement du résultat (jamais du texte d'origine), quota rendu en cas d'échec.
 */
export async function handleWriteTool<T>(options: {
  tool: "outline" | "correct" | "summarize";
  titleSource: string;
  wordCount: number;
  run: () => Promise<WriteResult<T>>;
}): Promise<Response> {
  const guard = await guardWriteTool({ consumesQuota: true });
  if (!guard.ok) return guard.response;
  try {
    const result = await options.run();
    await db.document.create({
      data: {
        userId: guard.userId,
        title: documentTitle(options.titleSource),
        wordCount: options.wordCount,
        analyses: {
          create: {
            type: "write",
            engine: result.engine,
            resultJson: {
              tool: options.tool,
              language: result.language,
              output: result.output as object,
            },
          },
        },
      },
    });
    return Response.json(result.output);
  } catch (error) {
    await releaseRewriteRequest(guard.userId);
    const code = error instanceof WriteError ? error.code : "UPSTREAM_ERROR";
    return Response.json({ error: code }, { status: code === "REFUSED" ? 422 : 502 });
  }
}
