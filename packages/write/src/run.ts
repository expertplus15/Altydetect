import {
  correctionDraftsSchema,
  detectLanguage,
  outlineOutputSchema,
  type CorrectInput,
  type CorrectOutput,
  type OutlineInput,
  type OutlineOutput,
  type SummarizeInput,
  type SummarizeOutput,
} from "@altydetect/core";
import { collectText, type StreamFactory } from "@altydetect/core/llm";
import { z } from "zod";
import { locateCorrections } from "./correct";
import { correctPrompt, outlinePrompt, summarizePrompt } from "./prompts";

export type WriteErrorCode = "REFUSED" | "INVALID_OUTPUT";

export class WriteError extends Error {
  constructor(readonly code: WriteErrorCode) {
    super(code);
    this.name = "WriteError";
  }
}

export interface WriteResult<T> {
  output: T;
  language: "fr" | "en";
  engine: string;
}

/** Schéma JSON envoyé à l'API (structured outputs), sans la clé $schema. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json.$schema;
  return json;
}

async function complete<T>(
  createStream: StreamFactory,
  prompt: { system: string; user: string },
  schema: z.ZodType<T> | null,
  signal?: AbortSignal,
): Promise<{ value: T | string; engine: string }> {
  const { text, stopReason, model } = await collectText(
    createStream({
      ...prompt,
      maxTokens: 16000,
      ...(schema ? { jsonSchema: jsonSchema(schema) } : {}),
      ...(signal ? { signal } : {}),
    }),
  );
  if (stopReason === "refusal") throw new WriteError("REFUSED");
  if (!schema) {
    if (!text.trim()) throw new WriteError("INVALID_OUTPUT");
    return { value: text.trim(), engine: model };
  }
  try {
    return { value: schema.parse(JSON.parse(text)), engine: model };
  } catch {
    throw new WriteError("INVALID_OUTPUT");
  }
}

export async function runOutline(
  input: OutlineInput,
  createStream: StreamFactory,
  signal?: AbortSignal,
): Promise<WriteResult<OutlineOutput>> {
  const language = input.language === "auto" ? detectLanguage(input.subject) : input.language;
  const { value, engine } = await complete(
    createStream,
    outlinePrompt(language, input.subject, input.level),
    outlineOutputSchema,
    signal,
  );
  return { output: value as OutlineOutput, language, engine };
}

export async function runCorrect(
  input: CorrectInput,
  createStream: StreamFactory,
  signal?: AbortSignal,
): Promise<WriteResult<CorrectOutput>> {
  const language = detectLanguage(input.text);
  const { value, engine } = await complete(
    createStream,
    correctPrompt(language, input.text),
    correctionDraftsSchema,
    signal,
  );
  const drafts = (value as z.infer<typeof correctionDraftsSchema>).corrections;
  return { output: { corrections: locateCorrections(input.text, drafts) }, language, engine };
}

export async function runSummarize(
  input: SummarizeInput,
  createStream: StreamFactory,
  signal?: AbortSignal,
): Promise<WriteResult<SummarizeOutput>> {
  const language = detectLanguage(input.text);
  const { value, engine } = await complete(
    createStream,
    summarizePrompt(language, input.text, input.length),
    null,
    signal,
  );
  return { output: { summary: value as string }, language, engine };
}
