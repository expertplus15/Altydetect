import { fakeStreamFactory } from "@altydetect/core/llm/testing";
import { describe, expect, it } from "vitest";
import { runCorrect, runOutline, runSummarize, WriteError } from "./run";

describe("module Écrire (modèle simulé)", () => {
  it("plan : demande une sortie JSON et la valide", async () => {
    const reply = JSON.stringify({
      title: "L'évaluation formative au collège",
      sections: [{ heading: "Introduction", points: ["Définir", "Enjeux"] }],
    });
    const factory = fakeStreamFactory(reply);
    const result = await runOutline(
      { subject: "L'évaluation formative au collège", level: "master", language: "auto" },
      factory,
    );
    expect(result.output.sections[0]?.heading).toBe("Introduction");
    expect(result.language).toBe("fr");
    const request = factory.requests[0];
    expect(request?.user).toContain("niveau master");
    expect(request?.jsonSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(request?.jsonSchema).not.toHaveProperty("$schema");
  });

  it("correction : place les fautes renvoyées par le modèle", async () => {
    const text = "J'ai pilotée la refonte du site.";
    const reply = JSON.stringify({
      corrections: [
        {
          original: "pilotée",
          replacement: "piloté",
          kind: "grammar",
          explanation: "Accord avec avoir.",
          context: "J'ai pilotée la refonte",
        },
      ],
    });
    const result = await runCorrect({ text }, fakeStreamFactory(reply));
    expect(result.output.corrections).toEqual([
      {
        start: 5,
        end: 12,
        original: "pilotée",
        replacement: "piloté",
        kind: "grammar",
        explanation: "Accord avec avoir.",
      },
    ]);
  });

  it("résumé : renvoie le texte du modèle", async () => {
    const result = await runSummarize(
      { text: "The survey shows that the method is effective for the students.", length: "short" },
      fakeStreamFactory("  The method works.  "),
    );
    expect(result).toMatchObject({ output: { summary: "The method works." }, language: "en" });
  });

  it("signale un refus et une sortie invalide", async () => {
    await expect(
      runSummarize(
        { text: "Texte", length: "short" },
        fakeStreamFactory("", { stopReason: "refusal" }),
      ),
    ).rejects.toEqual(new WriteError("REFUSED"));
    await expect(runCorrect({ text: "Texte" }, fakeStreamFactory("pas du JSON"))).rejects.toEqual(
      new WriteError("INVALID_OUTPUT"),
    );
  });
});
