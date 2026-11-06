"use client";

import type { RewriteInput, RewriteVariant } from "@altydetect/core";
import { useCallback, useRef, useState } from "react";

export type RewriteState =
  | { status: "idle" }
  | { status: "streaming"; variants: RewriteVariant[] }
  | {
      status: "done";
      variants: RewriteVariant[];
      documentId: string | null;
      analysisId: string | null;
      trial: boolean;
    }
  | { status: "error"; code: string; details: Record<string, unknown> };

/** Lit les événements SSE d'une réponse fetch. */
async function* readEvents(response: Response): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) as unknown };
    }
  }
}

/** Réécriture en flux via la route interne (aucun appel au modèle depuis le navigateur). */
export function useRewrite() {
  const [state, setState] = useState<RewriteState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (input: RewriteInput) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState({ status: "streaming", variants: [] });
    try {
      const response = await fetch("/internal/v1/rewrite", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(input),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        setState({
          status: "error",
          code: typeof body.error === "string" ? body.error : "default",
          details: body,
        });
        return;
      }
      for await (const { event, data } of readEvents(response)) {
        const payload = data as Record<string, unknown>;
        if (event === "progress") {
          setState({ status: "streaming", variants: payload.variants as RewriteVariant[] });
        } else if (event === "done") {
          setState({
            status: "done",
            variants: payload.variants as RewriteVariant[],
            documentId: (payload.documentId as string | null) ?? null,
            analysisId: (payload.analysisId as string | null) ?? null,
            trial: payload.trial === true,
          });
        } else if (event === "error") {
          setState({
            status: "error",
            code: typeof payload.error === "string" ? payload.error : "default",
            details: payload,
          });
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setState({ status: "error", code: "default", details: {} });
      }
    }
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    setState((current) => (current.status === "streaming" ? { status: "idle" } : current));
  }, []);

  return { state, run, stop };
}
