import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Téléchargement d'une page web pour en lire les métadonnées (citations). L'adresse vient de
// l'utilisateur : seules les adresses publiques sont autorisées (pas de réseau interne), avec
// un délai et une taille maximale.

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 6000;

/** Vrai pour une adresse IP publique (ni privée, ni locale, ni réservée). */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) return isPublicAddress(value.slice(7));
    return !(
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb") ||
      value.startsWith("ff")
    );
  }
  return false;
}

export type FetchPageError = "BLOCKED_ADDRESS" | "FETCH_FAILED" | "NOT_HTML";

export async function fetchPage(
  rawUrl: string,
): Promise<{ ok: true; html: string; url: string } | { ok: false; error: FetchPageError }> {
  let url = new URL(rawUrl);
  // Suit au plus 3 redirections, en revérifiant chaque destination.
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return { ok: false, error: "BLOCKED_ADDRESS" };
    if (url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
      return { ok: false, error: "BLOCKED_ADDRESS" };
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      return { ok: false, error: "BLOCKED_ADDRESS" };
    }
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "AltyDetect-Citation/1.0",
        },
      });
    } catch {
      return { ok: false, error: "FETCH_FAILED" };
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return { ok: false, error: "FETCH_FAILED" };
      url = new URL(next, url);
      continue;
    }
    if (!response.ok) return { ok: false, error: "FETCH_FAILED" };
    if (!(response.headers.get("content-type") ?? "").includes("html"))
      return { ok: false, error: "NOT_HTML" };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, error: "FETCH_FAILED" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    return {
      ok: true,
      html: new TextDecoder().decode(Buffer.concat(chunks)).slice(0, MAX_BYTES),
      url: url.toString(),
    };
  }
  return { ok: false, error: "FETCH_FAILED" };
}
