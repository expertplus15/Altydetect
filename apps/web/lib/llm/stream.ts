import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicStreamFactory, type StreamFactory } from "@altydetect/rewrite";
import { echoStreamFactory } from "@altydetect/rewrite/testing";

let factory: StreamFactory | null = null;

/**
 * Accès au modèle pour les routes internes. ALTY_LLM=fake (tests de bout en bout, jamais en
 * production réelle) remplace l'API par un flux simulé : aucun test n'appelle une API payante.
 */
export function getStreamFactory(): StreamFactory {
  if (!factory) {
    if (process.env.ALTY_LLM === "fake") {
      if (process.env.NODE_ENV === "production" && process.env.ALTY_E2E !== "1") {
        throw new Error("ALTY_LLM=fake est interdit en production.");
      }
      factory = echoStreamFactory();
    } else {
      factory = anthropicStreamFactory(new Anthropic());
    }
  }
  return factory;
}
