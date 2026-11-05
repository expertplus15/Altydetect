import type { CitationFields } from "@altydetect/core";

// Lecture des métadonnées bibliographiques d'une page web (balises citation_*, Dublin Core,
// Open Graph). Fonction pure : le téléchargement de la page est fait par l'application.

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function metaTags(html: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!key || content === undefined) continue;
    tags.set(key, [...(tags.get(key) ?? []), decode(content)]);
  }
  return tags;
}

function splitName(name: string): { family: string; given: string } {
  if (name.includes(",")) {
    const [family = "", given = ""] = name.split(",", 2);
    return { family: family.trim(), given: given.trim() };
  }
  const parts = name.trim().split(/\s+/);
  return { family: parts.at(-1) ?? name, given: parts.slice(0, -1).join(" ") };
}

export function metadataFromHtml(html: string, url: string, accessed: string): CitationFields {
  const tags = metaTags(html);
  const first = (...keys: string[]) => keys.map((k) => tags.get(k)?.[0]).find(Boolean) ?? "";
  const title =
    first("citation_title", "dc.title", "og:title", "twitter:title") ||
    decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "") ||
    url;
  const authorNames =
    tags.get("citation_author") ?? tags.get("dc.creator") ?? tags.get("author") ?? [];
  const date = first(
    "citation_publication_date",
    "citation_date",
    "dc.date",
    "article:published_time",
    "date",
  );
  const journal = first("citation_journal_title");
  const doi = first("citation_doi", "dc.identifier").replace(/^doi:/i, "");
  return {
    type: journal ? "article" : "web",
    authors: authorNames.slice(0, 30).map(splitName),
    title: title.slice(0, 500),
    year: /\b(1[5-9]\d{2}|20\d{2})\b/.exec(date)?.[1] ?? "",
    container: (journal || first("og:site_name", "citation_publisher", "dc.publisher")).slice(
      0,
      300,
    ),
    volume: first("citation_volume").slice(0, 20),
    issue: first("citation_issue").slice(0, 20),
    pages: [first("citation_firstpage"), first("citation_lastpage")]
      .filter(Boolean)
      .join("-")
      .slice(0, 30),
    publisher: first("citation_publisher", "dc.publisher").slice(0, 200),
    url,
    doi: /^10\.\d{4,}\//.test(doi) ? doi.slice(0, 200) : "",
    accessed,
  };
}
