import { describe, expect, it } from "vitest";
import { rewriteInputSchema } from "./rewrite";

describe("contrat de réécriture", () => {
  it("applique les valeurs par défaut", () => {
    expect(rewriteInputSchema.parse({ text: "Bonjour", register: "simple", intensity: 2 })).toEqual(
      {
        text: "Bonjour",
        register: "simple",
        intensity: 2,
        preserve_citations: true,
        variants: 1,
      },
    );
  });

  it("refuse un registre, une intensité ou un nombre de propositions invalides", () => {
    expect(
      rewriteInputSchema.safeParse({ text: "x", register: "poetic", intensity: 2 }).success,
    ).toBe(false);
    expect(
      rewriteInputSchema.safeParse({ text: "x", register: "simple", intensity: 4 }).success,
    ).toBe(false);
    expect(
      rewriteInputSchema.safeParse({ text: "x", register: "simple", intensity: 1, variants: 4 })
        .success,
    ).toBe(false);
    expect(
      rewriteInputSchema.safeParse({ text: "   ", register: "simple", intensity: 1 }).success,
    ).toBe(false);
  });
});
