import "server-only";
import { createVeritasClient, type VeritasClient } from "@altydetect/detect";

let client: VeritasClient | null = null;

/** Client du service Veritas (VERITAS_URL, VERITAS_INTERNAL_TOKEN). */
export function getVeritas(): VeritasClient {
  if (!client) {
    const token = process.env.VERITAS_INTERNAL_TOKEN;
    if (!token) throw new Error("VERITAS_INTERNAL_TOKEN manquant : voir .env.example.");
    client = createVeritasClient({
      baseUrl: process.env.VERITAS_URL ?? "http://localhost:8001",
      token,
    });
  }
  return client;
}
