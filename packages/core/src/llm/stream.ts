import Anthropic from "@anthropic-ai/sdk";
import { LLM_EFFORT, LLM_FALLBACK_BETA, LLM_MAX_TOKENS, LLM_MODEL } from "../config/llm";

// Accès au modèle, partagé par les modules Réécrire et Écrire. Les modules ne dépendent que de TextStream :
// les tests fournissent un flux simulé, jamais un appel réel (CLAUDE.md §9).

export interface StreamResult {
  stopReason: string | null;
  /** Modèle qui a réellement répondu (peut différer en cas de repli sur refus). */
  model: string;
}

export interface TextStream {
  /** Fragments de texte de la réponse, dans l'ordre. */
  textDeltas: AsyncIterable<string>;
  done(): Promise<StreamResult>;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Sortie JSON contrainte par un schéma (structured outputs). */
  jsonSchema?: Record<string, unknown>;
}

export type StreamFactory = (request: LlmRequest) => TextStream;

/** Flux réel : API Claude, modèle de config/llm.ts, repli serveur en cas de refus. */
export function anthropicStreamFactory(client: Anthropic = new Anthropic()): StreamFactory {
  return ({ system, user, maxTokens, signal, jsonSchema }) => {
    const stream = client.beta.messages.stream(
      {
        model: LLM_MODEL,
        max_tokens: maxTokens ?? LLM_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          effort: LLM_EFFORT,
          ...(jsonSchema ? { format: { type: "json_schema" as const, schema: jsonSchema } } : {}),
        },
        betas: [LLM_FALLBACK_BETA],
        fallbacks: "default",
      },
      signal ? { signal } : undefined,
    );
    async function* textDeltas() {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    }
    return {
      textDeltas: textDeltas(),
      async done() {
        const message = await stream.finalMessage();
        return { stopReason: message.stop_reason, model: message.model };
      },
    };
  };
}

/** Lit tout le flux et renvoie le texte complet. */
export async function collectText(stream: TextStream): Promise<{ text: string } & StreamResult> {
  let text = "";
  for await (const delta of stream.textDeltas) text += delta;
  return { text, ...(await stream.done()) };
}
