import type { LlmRequest, StreamFactory, StreamResult } from "./llm";

/** Flux simulé pour les tests : renvoie le texte donné en plusieurs fragments. */
export function fakeStreamFactory(
  reply: string | ((request: LlmRequest) => string),
  result: Partial<StreamResult> = {},
): StreamFactory & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const factory = (request: LlmRequest) => {
    requests.push(request);
    const text = typeof reply === "function" ? reply(request) : reply;
    async function* textDeltas() {
      for (let i = 0; i < text.length; i += 7) {
        await Promise.resolve();
        yield text.slice(i, i + 7);
      }
    }
    return {
      textDeltas: textDeltas(),
      done: () =>
        Promise.resolve({ stopReason: "end_turn", model: "claude-sonnet-5-5", ...result }),
    };
  };
  return Object.assign(factory, { requests });
}

/**
 * Flux simulé « écho » pour les tests de bout en bout : recopie le texte (marqueurs compris)
 * dans autant de propositions que demandé. Aucun appel réseau.
 */
export function echoStreamFactory(): StreamFactory {
  return fakeStreamFactory((request) => {
    const original =
      /<texte_original>\n([\s\S]*)\n<\/texte_original>/.exec(request.user)?.[1] ?? "";
    const count = Number(/(?:Rédige|Write) (\d)/.exec(request.user)?.[1] ?? "1");
    return Array.from(
      { length: count },
      (_, i) =>
        `<proposition>\n<texte>${original}</texte>\n<changements>Proposition de test ${i + 1}.</changements>\n</proposition>\n`,
    ).join("");
  });
}
