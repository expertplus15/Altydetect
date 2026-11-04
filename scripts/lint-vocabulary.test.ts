import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FORBIDDEN_TERMS, findForbiddenTerms, scanDirectories } from "./lint-vocabulary";

describe("findForbiddenTerms", () => {
  it("détecte chaque terme interdit, quelle que soit la casse", () => {
    for (const term of FORBIDDEN_TERMS) {
      expect(findForbiddenTerms(`Texte ${term.toUpperCase()} ici`)).toEqual([{ line: 1, term }]);
    }
  });

  it("donne le bon numéro de ligne", () => {
    expect(findForbiddenTerms("ligne propre\nun texte indétectable")).toEqual([
      { line: 2, term: "indétectable" },
    ]);
  });

  it("accepte le vocabulaire imposé", () => {
    const ok = "Probablement IA. Un détecteur donne une probabilité, pas une preuve.";
    expect(findForbiddenTerms(ok)).toEqual([]);
  });
});

describe("scanDirectories", () => {
  let root: string;

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("signale le fichier fautif et ignore les dossiers absents", () => {
    root = mkdtempSync(join(tmpdir(), "vocab-"));
    mkdirSync(join(root, "apps/web/messages"), { recursive: true });
    writeFileSync(join(root, "apps/web/messages/fr.json"), '{ "a": "propre" }');
    writeFileSync(join(root, "apps/web/messages/en.json"), '{\n  "b": "Bypass detectors"\n}');

    expect(scanDirectories(root)).toEqual([
      { file: join("apps/web/messages", "en.json"), line: 2, term: "bypass" },
    ]);
  });
});

describe("dépôt AltyDetect", () => {
  it("ne contient aucun terme interdit dans les dossiers analysés", () => {
    const repoRoot = resolve(import.meta.dirname, "..");
    expect(scanDirectories(repoRoot)).toEqual([]);
  });
});
