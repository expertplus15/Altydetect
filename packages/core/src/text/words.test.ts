import { describe, expect, it } from "vitest";
import { countWords } from "./words";

describe("countWords", () => {
  it("compte les mots d'une phrase française", () => {
    expect(countWords("L'évaluation formative change la relation à l'erreur.")).toBe(7);
  });

  it("ignore la ponctuation isolée et les espaces multiples", () => {
    expect(countWords("Un  —  deux : trois !\n\nquatre")).toBe(4);
    expect(countWords("   ")).toBe(0);
    expect(countWords("")).toBe(0);
  });

  it("compte les nombres et les mots composés", () => {
    expect(countWords("Un gain de 32 % en 2021, c'est-à-dire beaucoup")).toBe(8);
  });

  it("gère les espaces insécables", () => {
    expect(countWords("mot : suite")).toBe(2);
  });
});
