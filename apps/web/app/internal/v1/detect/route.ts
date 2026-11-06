import {
  countWords,
  DETECT_MIN_WORDS,
  detectInputSchema,
  LLM_MAX_INPUT_WORDS,
  type DetectOutput,
} from "@altydetect/core";
import { VeritasError } from "@altydetect/detect";
import { auth } from "@/auth";
import { consumeDetectionQuota } from "@/lib/billing/quota";
import { releaseDetectionWords } from "@/lib/billing/quota-release";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { getVeritas } from "@/lib/detect/veritas";
import { documentTitle } from "@/lib/server/document-title";

export const dynamic = "force-dynamic";

/**
 * POST /internal/v1/detect : contrôle d'accès et de quota, puis détection confiée à Veritas
 * (qui choisit entre le fournisseur externe et ses propres modèles). Le texte n'est enregistré
 * que si keep_text vaut true (CLAUDE.md §4.5).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const userId = session.user.id;

  const parsed = detectInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { text, language, mode, keep_text } = parsed.data;
  const words = countWords(text);
  if (words < DETECT_MIN_WORDS) {
    return Response.json({ error: "TEXT_TOO_SHORT", minWords: DETECT_MIN_WORDS }, { status: 422 });
  }
  if (words > LLM_MAX_INPUT_WORDS) {
    return Response.json(
      { error: "TEXT_TOO_LONG", maxWords: LLM_MAX_INPUT_WORDS },
      { status: 413 },
    );
  }
  const { plan } = await getUserPlan(userId);
  // L'analyse approfondie (deux avis) est incluse dans Pro.
  if (mode === "deep" && plan !== "pro") {
    return Response.json({ error: "UPGRADE_REQUIRED" }, { status: 402 });
  }

  const quota = await consumeDetectionQuota(userId, words);
  if (!quota.allowed) {
    return Response.json(
      {
        error: quota.reason,
        resetsAt: quota.resetsAt.toISOString(),
        used: quota.used,
        limit: quota.limit,
      },
      { status: quota.reason === "TEXT_TOO_SHORT" ? 422 : 429 },
    );
  }

  let output: DetectOutput;
  try {
    output = await getVeritas().detect({ text, language, mode, plan });
  } catch (error) {
    await releaseDetectionWords(userId, words);
    if (error instanceof VeritasError && error.code === "TEXT_TOO_SHORT") {
      return Response.json(
        { error: "TEXT_TOO_SHORT", minWords: error.minWords ?? DETECT_MIN_WORDS },
        { status: 422 },
      );
    }
    return Response.json({ error: "DETECTION_UNAVAILABLE" }, { status: 503 });
  }

  const document = await db.document.create({
    data: {
      userId,
      title: documentTitle(text),
      wordCount: words,
      ...(keep_text ? { text } : {}),
      analyses: {
        create: { type: "detect", engine: output.engine.primary, resultJson: { mode, output } },
      },
    },
    include: { analyses: { select: { id: true } } },
  });
  return Response.json({ ...output, analysisId: document.analyses[0]?.id ?? null });
}
