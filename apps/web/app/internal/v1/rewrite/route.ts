import {
  countWords,
  LLM_MAX_INPUT_WORDS,
  rewriteInputSchema,
  type RewriteInput,
} from "@altydetect/core";
import { RewriteError, runRewrite, type ParsedVariant } from "@altydetect/rewrite";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { consumeRewriteQuota } from "@/lib/billing/quota";
import { releaseRewriteRequest } from "@/lib/billing/quota-release";
import { getUserPlan } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { getStreamFactory } from "@/lib/llm/stream";
import { sseResponse, throttle } from "@/lib/llm/sse";
import { documentTitle } from "@/lib/server/document-title";
import { getRedis } from "@/lib/server/redis";
import { requestIp } from "@/lib/server/request-ip";
import { consumeTrial, newTrialId, saveTrialResult, TRIAL_COOKIE } from "@/lib/trial";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function error(code: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: code, ...extra }, { status });
}

type Actor = { kind: "user"; userId: string } | { kind: "trial"; trialId: string };

/**
 * POST /internal/v1/rewrite (contrat CLAUDE.md §5).
 * Réponse JSON { variants } par défaut ; flux SSE (progress, done, error) si le client envoie
 * Accept: text/event-stream. Le quota est vérifié et consommé AVANT l'appel au modèle.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = rewriteInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error("INVALID_INPUT", 400);
  }
  const words = countWords(parsed.data.text);
  if (words > LLM_MAX_INPUT_WORDS) {
    return error("TEXT_TOO_LONG", 413, { maxWords: LLM_MAX_INPUT_WORDS });
  }

  // --- Qui demande, et a-t-il le droit ? ---
  let input: RewriteInput = parsed.data;
  let actor: Actor;
  const session = await auth();
  if (session?.user?.id) {
    const quota = await consumeRewriteQuota(session.user.id);
    if (!quota.allowed) {
      return error("QUOTA_EXCEEDED", 429, {
        resetsAt: quota.resetsAt.toISOString(),
        limit: quota.limitHidden ? null : quota.limit,
      });
    }
    // Plusieurs propositions : réservé à Pro (page Tarifs).
    if ((await getUserPlan(session.user.id)).plan !== "pro") {
      input = { ...input, variants: 1 };
    }
    actor = { kind: "user", userId: session.user.id };
  } else {
    const store = await cookies();
    const trialId = store.get(TRIAL_COOKIE)?.value ?? newTrialId();
    const check = await consumeTrial(getRedis(), trialId, requestIp(request));
    if (check !== "ok") {
      return error(check === "already_used" ? "SIGN_UP_REQUIRED" : "TRIAL_LIMIT", 403);
    }
    store.set(TRIAL_COOKIE, trialId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
    input = { ...input, variants: 1 };
    actor = { kind: "trial", trialId };
  }

  // --- Réécriture, puis enregistrement du résultat (jamais du texte original) ---
  async function execute(onProgress?: (variants: ParsedVariant[]) => void) {
    try {
      const result = await runRewrite(input, getStreamFactory(), {
        ...(onProgress ? { onProgress } : {}),
        signal: request.signal,
      });
      const resultJson = {
        input: {
          register: input.register,
          intensity: input.intensity,
          preserve_citations: input.preserve_citations,
          variants: input.variants,
          language: result.language,
        },
        output: result.output,
      };
      let documentId: string | null = null;
      let analysisId: string | null = null;
      if (actor.kind === "user") {
        const document = await db.document.create({
          data: {
            userId: actor.userId,
            title: documentTitle(input.text),
            wordCount: words,
            analyses: { create: { type: "rewrite", engine: result.engine, resultJson } },
          },
          include: { analyses: { select: { id: true } } },
        });
        documentId = document.id;
        analysisId = document.analyses[0]?.id ?? null;
      } else {
        await saveTrialResult(getRedis(), actor.trialId, {
          type: "rewrite",
          title: documentTitle(input.text),
          wordCount: words,
          engine: result.engine,
          result: resultJson,
        });
      }
      return { ok: true as const, result, documentId, analysisId };
    } catch (cause) {
      if (actor.kind === "user") {
        await releaseRewriteRequest(actor.userId);
      }
      const code = cause instanceof RewriteError ? cause.code : "UPSTREAM_ERROR";
      return { ok: false as const, code };
    }
  }

  if (!request.headers.get("accept")?.includes("text/event-stream")) {
    const outcome = await execute();
    return outcome.ok
      ? Response.json(outcome.result.output)
      : error(outcome.code, outcome.code === "REFUSED" ? 422 : 502);
  }

  return sseResponse(async (send) => {
    const progress = throttle((variants: ParsedVariant[]) => send("progress", { variants }), 80);
    const outcome = await execute((variants) => progress.push(variants));
    progress.flush();
    if (outcome.ok) {
      send("done", {
        ...outcome.result.output,
        documentId: outcome.documentId,
        analysisId: outcome.analysisId,
        language: outcome.result.language,
        trial: actor.kind === "trial",
      });
    } else {
      send("error", { error: outcome.code });
    }
  });
}
