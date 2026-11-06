// Flux Server-Sent Events vers le navigateur.

export type SseSend = (event: string, data: unknown) => void;

export function sseResponse(run: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: SseSend = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Limite la fréquence d'un envoi (au plus une fois par intervalle, plus le dernier état). */
export function throttle<T>(fn: (value: T) => void, intervalMs: number) {
  let last = 0;
  let pending: T | null = null;
  return {
    push(value: T) {
      const now = Date.now();
      if (now - last >= intervalMs) {
        last = now;
        pending = null;
        fn(value);
      } else {
        pending = value;
      }
    },
    flush() {
      if (pending !== null) fn(pending);
      pending = null;
    },
  };
}
