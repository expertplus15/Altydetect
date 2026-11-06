import { describe, expect, it } from "vitest";
import { collectText } from "./stream";
import { e2eStreamFactory } from "./testing";

describe("e2eStreamFactory", () => {
  const run = (request: Parameters<ReturnType<typeof e2eStreamFactory>>[0]) =>
    collectText(e2eStreamFactory()(request));

  it("recopie le texte d'une réécriture dans le nombre de propositions demandé", async () => {
    const { text } = await run({
      system: "",
      user: "Rédige 2 propositions\n<texte_original>\nBonjour ⟦1⟧\n</texte_original>",
    });
    expect(text.match(/<proposition>/g)).toHaveLength(2);
    expect(text).toContain("<texte>Bonjour ⟦1⟧</texte>");
  });

  it("répond en JSON au plan et à la correction, en texte au résumé", async () => {
    expect(
      JSON.parse(
        (await run({ system: "", user: "", jsonSchema: { properties: { sections: {} } } })).text,
      ),
    ).toHaveProperty("sections");
    expect(
      JSON.parse(
        (await run({ system: "", user: "", jsonSchema: { properties: { corrections: {} } } })).text,
      ),
    ).toEqual({ corrections: [] });
    expect((await run({ system: "", user: "Résume" })).text).toBe("Résumé de test.");
  });
});
