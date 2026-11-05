import "server-only";
import { createIndexaClient, type IndexaClient } from "@altydetect/plagiarism";

let client: IndexaClient | null = null;

/** Client du service Indexa (INDEXA_URL, INDEXA_INTERNAL_TOKEN). */
export function getIndexa(): IndexaClient {
  if (!client) {
    const token = process.env.INDEXA_INTERNAL_TOKEN;
    if (!token) throw new Error("INDEXA_INTERNAL_TOKEN manquant : voir .env.example.");
    client = createIndexaClient({
      baseUrl: process.env.INDEXA_URL ?? "http://localhost:8002",
      token,
    });
  }
  return client;
}
