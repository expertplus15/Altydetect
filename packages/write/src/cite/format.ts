import type { CitationFields, CitationStyle } from "@altydetect/core";

// Mise en forme bibliographique déterministe (pas de modèle) : APA 7, MLA 9, Chicago
// (auteur-date) et ISO 690. L'italique est noté *ainsi* ; l'interface le rend en italique.

type Author = CitationFields["authors"][number];

const initials = (given: string) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}.`)
    .join(" ");

/** Liste d'auteurs. Le premier nom étant inversé (« Nom, Prénom »), une virgule précède toujours
 * la conjonction finale, même pour deux auteurs (APA 7, Chicago). */
function joinList(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")}, ${and} ${items.at(-1)}`;
}

const doiUrl = (doi: string) =>
  doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : "";
const end = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);
/** Titre en italique suivi du point, placé hors de l'italique (*Titre*.). */
const italicEnd = (text: string) => (/[.?!]$/.test(text) ? `*${text}*` : `*${text}*.`);

function apa(f: CitationFields, locale: "fr" | "en"): string {
  const names = f.authors.map((a: Author) =>
    a.given ? `${a.family}, ${initials(a.given)}` : a.family,
  );
  const authors =
    names.length > 20
      ? `${names.slice(0, 19).join(", ")}, … ${names.at(-1)}`
      : joinList(names, "&");
  const date = `(${f.year || (locale === "fr" ? "s.d." : "n.d.")})`;
  const link = doiUrl(f.doi) || f.url;
  // Sans auteur, le titre prend sa place (en italique pour un livre ou une page web).
  const titleFirst = f.type === "article" ? end(f.title) : italicEnd(f.title);
  const head = authors ? `${end(authors)} ${date}.` : `${titleFirst} ${date}.`;
  let body: string;
  if (f.type === "article") {
    const volume = f.volume ? `, *${f.volume}*${f.issue ? `(${f.issue})` : ""}` : "";
    body = `${authors ? `${end(f.title)} ` : ""}*${f.container}*${volume}${f.pages ? `, ${f.pages}` : ""}.`;
  } else if (f.type === "book") {
    body = `${authors ? italicEnd(f.title) : ""}${f.publisher ? ` ${end(f.publisher)}` : ""}`;
  } else {
    body = `${authors ? italicEnd(f.title) : ""}${f.container ? ` ${end(f.container)}` : ""}`;
  }
  return [head, body.trim(), link].filter(Boolean).join(" ");
}

function mlaAuthors(authors: Author[]): string {
  const first = authors[0];
  if (!first) return "";
  const inverted = first.given ? `${first.family}, ${first.given}` : first.family;
  if (authors.length === 1) return inverted;
  if (authors.length === 2) {
    const second = authors[1] as Author;
    return `${inverted}, and ${[second.given, second.family].filter(Boolean).join(" ")}`;
  }
  return `${inverted}, et al`;
}

function mla(f: CitationFields): string {
  const authors = mlaAuthors(f.authors);
  const title = f.type === "book" ? italicEnd(f.title) : `“${end(f.title)}”`;
  const link = f.doi ? doiUrl(f.doi) : f.url.replace(/^https?:\/\//, "");
  // MLA 9 : éléments du conteneur séparés par des virgules, lien compris, un seul point final.
  const parts = [
    f.type !== "book" && f.container ? `*${f.container}*` : "",
    f.type === "book" ? f.publisher : "",
    f.volume ? `vol. ${f.volume}` : "",
    f.issue ? `no. ${f.issue}` : "",
    f.year,
    f.pages ? `pp. ${f.pages}` : "",
    link,
  ].filter(Boolean);
  return [authors ? end(authors) : "", title, parts.length ? end(parts.join(", ")) : ""]
    .filter(Boolean)
    .join(" ");
}

function chicago(f: CitationFields): string {
  const names = f.authors.map((a, i) =>
    i === 0
      ? a.given
        ? `${a.family}, ${a.given}`
        : a.family
      : [a.given, a.family].filter(Boolean).join(" "),
  );
  const authors =
    names.length > 10 ? `${names.slice(0, 7).join(", ")}, et al` : joinList(names, "and");
  const year = f.year || "n.d.";
  const link = doiUrl(f.doi) || f.url;
  let body: string;
  if (f.type === "article") {
    const volume = f.volume ? ` ${f.volume}${f.issue ? ` (${f.issue})` : ""}` : "";
    body = `“${end(f.title)}” *${f.container}*${volume}${f.pages ? `: ${f.pages}` : ""}.`;
  } else if (f.type === "book") {
    body = `${italicEnd(f.title)}${f.publisher ? ` ${end(f.publisher)}` : ""}`;
  } else {
    body = `“${end(f.title)}”${f.container ? ` ${end(f.container)}` : ""}`;
  }
  return [authors ? end(authors) : "", end(year), body, link ? end(link) : ""]
    .filter(Boolean)
    .join(" ");
}

function iso690(f: CitationFields, locale: "fr" | "en"): string {
  const authors = f.authors
    .slice(0, 3)
    .map((a) => (a.given ? `${a.family.toUpperCase()}, ${a.given}` : a.family.toUpperCase()));
  const authorText = authors.length
    ? `${authors.join(", ")}${f.authors.length > 3 ? " et al" : ""}.`
    : "";
  const online = locale === "fr" ? "[en ligne]" : "[online]";
  const available = locale === "fr" ? "Disponible à l'adresse :" : "Available from:";
  const accessed = locale === "fr" ? "consulté le" : "viewed";
  const link = doiUrl(f.doi) || f.url;
  let body: string;
  if (f.type === "article") {
    body = `${end(f.title)} *${f.container}*${link ? ` ${online}` : ""}. ${[
      f.year,
      f.volume ? `vol. ${f.volume}` : "",
      f.issue ? `n° ${f.issue}` : "",
      f.pages ? `p. ${f.pages}` : "",
    ]
      .filter(Boolean)
      .join(", ")}.`;
  } else if (f.type === "book") {
    body = `*${f.title}*${link ? ` ${online}` : ""}. ${[f.publisher, f.year].filter(Boolean).join(", ")}.`;
  } else {
    body = `*${f.title}*${link ? ` ${online}` : ""}.${f.container ? ` ${end(f.container)}` : ""}${f.year ? ` ${end(f.year)}` : ""}`;
  }
  const access = link
    ? `${available} ${link}${f.accessed ? ` [${accessed} ${f.accessed}]` : ""}`
    : "";
  return [authorText, body, access].filter(Boolean).join(" ").replace(/\.\./g, ".");
}

export function formatCitation(
  style: CitationStyle,
  fields: CitationFields,
  locale: "fr" | "en" = "fr",
): string {
  switch (style) {
    case "apa7":
      return apa(fields, locale);
    case "mla9":
      return mla(fields);
    case "chicago":
      return chicago(fields);
    case "iso690":
      return iso690(fields, locale);
  }
}

/** Champs que la norme attend et qui manquent (affichés pour que l'utilisateur complète). */
export function missingFields(fields: CitationFields): string[] {
  const missing: string[] = [];
  if (fields.authors.length === 0) missing.push("authors");
  if (!fields.year) missing.push("year");
  if (fields.type === "article" && !fields.container) missing.push("container");
  if (fields.type === "book" && !fields.publisher) missing.push("publisher");
  if (fields.type === "web" && !fields.url) missing.push("url");
  if (fields.type === "web" && !fields.accessed) missing.push("accessed");
  return missing;
}
