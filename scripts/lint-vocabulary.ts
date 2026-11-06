/**
 * Vérifie le vocabulaire produit (CLAUDE.md, section 7).
 *
 * Échoue si un terme interdit apparaît dans les fichiers visibles :
 * messages d'interface, pages de l'application, documentation publique.
 *
 * Usage : pnpm lint:vocabulary
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Termes interdits, comparés sans tenir compte de la casse. */
export const FORBIDDEN_TERMS = [
  "contourner",
  "bypass",
  "indétectable",
  "undetectable",
  "tromper",
  "passer les détecteurs",
  "humanizer",
] as const;

/** Dossiers analysés, relatifs à la racine du dépôt. */
export const SCANNED_DIRS = ["apps/web/messages", "apps/web/app", "docs/public"] as const;

const SCANNED_EXTENSIONS = [".json", ".ts", ".tsx", ".js", ".jsx", ".md", ".mdx", ".html"];

export interface Violation {
  file: string;
  line: number;
  term: string;
}

/** Retourne les termes interdits trouvés dans un texte, avec leur numéro de ligne. */
export function findForbiddenTerms(content: string): { line: number; term: string }[] {
  const found: { line: number; term: string }[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    const lower = text.toLocaleLowerCase("fr");
    for (const term of FORBIDDEN_TERMS) {
      if (lower.includes(term)) {
        found.push({ line: index + 1, term });
      }
    }
  });
  return found;
}

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Un dossier absent (ex. docs/public) n'est pas une erreur.
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return listFiles(path);
    }
    return SCANNED_EXTENSIONS.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

/** Analyse les dossiers donnés et retourne toutes les violations. */
export function scanDirectories(root: string, dirs: readonly string[] = SCANNED_DIRS): Violation[] {
  return dirs.flatMap((dir) =>
    listFiles(join(root, dir)).flatMap((file) =>
      findForbiddenTerms(readFileSync(file, "utf8")).map((hit) => ({
        file: relative(root, file),
        ...hit,
      })),
    ),
  );
}

function main(): void {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const violations = scanDirectories(root);
  if (violations.length === 0) {
    console.log("lint-vocabulary : aucun terme interdit.");
    return;
  }
  for (const v of violations) {
    console.error(`${v.file}:${v.line} — terme interdit « ${v.term} »`);
  }
  console.error(`lint-vocabulary : ${violations.length} violation(s). Voir CLAUDE.md, section 7.`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
