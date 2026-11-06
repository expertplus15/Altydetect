// Appel d'une route interne : renvoie la réponse JSON ou le code d'erreur.
export async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok)
      return { ok: false, error: typeof data.error === "string" ? data.error : "default" };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "default" };
  }
}

export const KNOWN_WRITE_ERRORS = [
  "QUOTA_EXCEEDED",
  "BLOCKED_ADDRESS",
  "FETCH_FAILED",
  "NOT_HTML",
  "TEXT_TOO_LONG",
  "REFUSED",
  "INVALID_INPUT",
];
