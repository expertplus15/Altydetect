import { describe, expect, it } from "vitest";
import { applyCorrections, locateCorrections } from "./correct";

const TEXT =
  "Je souhaiterais mettre a profit mon expérience. J'ai pilotée la refonte et a mon avis c'est utile.";

describe("locateCorrections", () => {
  it("place chaque correction au bon endroit grâce au contexte", () => {
    const corrections = locateCorrections(TEXT, [
      {
        original: "a",
        replacement: "à",
        kind: "spelling",
        explanation: "Préposition.",
        context: "a mon avis",
      },
      {
        original: "a",
        replacement: "à",
        kind: "spelling",
        explanation: "Préposition.",
        context: "mettre a profit",
      },
      {
        original: "pilotée",
        replacement: "piloté",
        kind: "grammar",
        explanation: "Avoir.",
        context: "J'ai pilotée",
      },
    ]);
    expect(corrections.map((c) => [c.start, TEXT.slice(c.start, c.end)])).toEqual([
      [TEXT.indexOf("a profit"), "a"],
      [TEXT.indexOf("pilotée"), "pilotée"],
      [TEXT.indexOf("a mon avis"), "a"],
    ]);
    expect(applyCorrections(TEXT, corrections)).toBe(
      "Je souhaiterais mettre à profit mon expérience. J'ai piloté la refonte et à mon avis c'est utile.",
    );
  });

  it("sans contexte, préfère un mot entier à un morceau de mot", () => {
    const [c] = locateCorrections(TEXT, [
      { original: "a", replacement: "à", kind: "spelling", explanation: "", context: "" },
    ]);
    expect(c?.start).toBe(TEXT.indexOf("a profit"));
  });

  it("écarte une correction introuvable ou sans effet", () => {
    expect(
      locateCorrections(TEXT, [
        {
          original: "inexistant",
          replacement: "x",
          kind: "spelling",
          explanation: "",
          context: "",
        },
        {
          original: "refonte",
          replacement: "refonte",
          kind: "spelling",
          explanation: "",
          context: "",
        },
      ]),
    ).toEqual([]);
  });
});
