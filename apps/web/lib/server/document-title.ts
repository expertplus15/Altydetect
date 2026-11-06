/** Titre d'un document : ses premiers mots (le texte lui-même n'est pas conservé). */
export function documentTitle(text: string, maxWords = 8): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, maxWords).join(" ");
  return (words.length > maxWords ? `${head}…` : head).slice(0, 120) || "Document";
}
