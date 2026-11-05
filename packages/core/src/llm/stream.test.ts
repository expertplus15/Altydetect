import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { LLM_EFFORT, LLM_FALLBACK_BETA, LLM_MAX_TOKENS, LLM_MODEL } from "../config/llm";
import { anthropicStreamFactory, collectText } from "./stream";

// Client Anthropic simulé : aucun appel réseau, on vérifie la requête envoyée et la lecture du flux.
function fakeClient(events: unknown[], final: { stop_reason: string; model: string }) {
  const stream = vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield await Promise.resolve(event);
    },
    finalMessage: () => Promise.resolve(final),
  }));
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, stream };
}

const delta = (text: string) => ({
  type: "content_block_delta",
  delta: { type: "text_delta", text },
});

describe("anthropicStreamFactory", () => {
  it("envoie le modèle, l'effort et le repli de config/llm.ts et lit le texte", async () => {
    const { client, stream } = fakeClient(
      [
        { type: "message_start" },
        delta("Bon"),
        { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } },
        delta("jour"),
      ],
      { stop_reason: "end_turn", model: LLM_MODEL },
    );
    const result = await collectText(anthropicStreamFactory(client)({ system: "S", user: "U" }));
    expect(result).toEqual({ text: "Bonjour", stopReason: "end_turn", model: LLM_MODEL });
    expect(stream).toHaveBeenCalledWith(
      {
        model: LLM_MODEL,
        max_tokens: LLM_MAX_TOKENS,
        system: "S",
        messages: [{ role: "user", content: "U" }],
        output_config: { effort: LLM_EFFORT },
        betas: [LLM_FALLBACK_BETA],
        fallbacks: "default",
      },
      undefined,
    );
  });

  it("transmet le schéma JSON, le plafond de sortie et le signal d'annulation", async () => {
    const { client, stream } = fakeClient([delta("{}")], {
      stop_reason: "end_turn",
      model: "claude-opus-4-8",
    });
    const signal = new AbortController().signal;
    const schema = { type: "object", properties: {}, additionalProperties: false };
    const result = await collectText(
      anthropicStreamFactory(client)({
        system: "S",
        user: "U",
        maxTokens: 1000,
        jsonSchema: schema,
        signal,
      }),
    );
    // Le modèle qui a répondu peut être celui du repli.
    expect(result.model).toBe("claude-opus-4-8");
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 1000,
        output_config: { effort: LLM_EFFORT, format: { type: "json_schema", schema } },
      }),
      { signal },
    );
  });
});
