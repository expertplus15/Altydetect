// Détection de langue français / anglais par mots outils : suffisante pour choisir la langue
// du prompt. La langue d'interface n'intervient pas (CLAUDE.md §4.7).

const FR = new Set(
  "le la les un une des du de et est que qui dans pour pas sur avec au aux ce cette ces son sa ses leur nous vous ils elles mais ou donc ne plus être été très aussi comme".split(
    " ",
  ),
);
const EN = new Set(
  "the a an and is are was were that which who in for not on with to of this these those its their we you they but or so be been very also as it from by have has".split(
    " ",
  ),
);

export function detectLanguage(text: string): "fr" | "en" {
  let fr = 0;
  let en = 0;
  for (const raw of text.toLowerCase().split(/[^\p{L}']+/u)) {
    const word = raw.replace(/^[a-z]'/, "");
    if (FR.has(word)) fr += 1;
    if (EN.has(word)) en += 1;
  }
  if (/[éèêàùçœ]/.test(text)) fr += 2;
  return en > fr ? "en" : "fr";
}
