import type { RewriteInput, RewriteOutput } from "@altydetect/core";
import { buildRewriteRequest } from "./build";
import type { StreamFactory } from "./llm";
import { finalizeVariants, parseVariants, type ParsedVariant } from "./parse";

export type RewriteErrorCode = "REFUSED" | "INVALID_OUTPUT";

export class RewriteError extends Error {
  constructor(readonly code: RewriteErrorCode) {
    super(code);
    this.name = "RewriteError";
  }
}

export interface RewriteRunResult {
  output: RewriteOutput;
  language: "fr" | "en";
  engine: string;
  truncated: boolean;
}

/**
 * Lance une réécriture en flux. onProgress reçoit l'état des propositions à chaque fragment
 * (passages protégés déjà restaurés). Le résultat final respecte le contrat RewriteOutput.
 */
export async function runRewrite(
  input: RewriteInput,
  createStream: StreamFactory,
  options: { onProgress?: (variants: ParsedVariant[]) => void; signal?: AbortSignal } = {},
): Promise<RewriteRunResult> {
  const request = buildRewriteRequest(input);
  const stream = createStream({
    system: request.system,
    user: request.user,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  let output = "";
  for await (const delta of stream.textDeltas) {
    output += delta;
    options.onProgress?.(parseVariants(output, request.spans));
  }
  const { stopReason, model } = await stream.done();
  if (stopReason === "refusal") {
    throw new RewriteError("REFUSED");
  }

  const { variants } = finalizeVariants(output, request.spans);
  if (variants.length === 0) {
    throw new RewriteError("INVALID_OUTPUT");
  }
  return {
    output: { variants: variants.slice(0, input.variants) },
    language: request.language,
    engine: model,
    truncated: stopReason === "max_tokens",
  };
}
