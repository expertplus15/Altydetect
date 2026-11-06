/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Rapport PDF combiné d'une analyse : plagiat (phase 2), détection (phase 3, section prévue).
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { registerFonts } from "./fonts";

export interface AnalysisReportLabels {
  title: string;
  date: string;
  timestamp: string;
  engine: string;
  scope: string;
  plagiarism: string;
  similarity: string;
  sources: string;
  source: string;
  passages: string;
  bestScore: string;
  text: string;
  textMissing: string;
  noMatch: string;
  detection: string;
  detectionPending: string;
  disclaimer: string;
  footer: string;
}

export interface AnalysisReportData {
  locale: "fr" | "en";
  scopeName: string;
  engine: string;
  createdAt: Date;
  generatedAt: Date;
  plagiarism: {
    similarity: number;
    /** Texte analysé, transmis pour l'export seulement (jamais stocké) ; null s'il est absent. */
    text: string | null;
    matches: { start: number; end: number; sourceLabel: string }[];
    sources: { label: string; url: string | null; passages: number; bestScore: number }[];
  };
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10,
    lineHeight: 1.55,
    color: "#141a26",
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 52,
  },
  brand: { fontSize: 11, fontWeight: 600, color: "#1d4ed8" },
  title: { fontSize: 18, fontWeight: 600, marginTop: 6, marginBottom: 14 },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    paddingVertical: 10,
    borderTop: "1 solid #dfe4ee",
    borderBottom: "1 solid #dfe4ee",
    marginBottom: 18,
  },
  metaLabel: { fontSize: 8, color: "#586174", textTransform: "uppercase", letterSpacing: 0.6 },
  h2: { fontSize: 13, fontWeight: 600, marginBottom: 8, marginTop: 6 },
  label: {
    fontSize: 8.5,
    fontWeight: 600,
    color: "#586174",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  big: { fontSize: 26, fontWeight: 600, lineHeight: 1.25, marginBottom: 14 },
  row: { flexDirection: "row", borderBottom: "1 solid #eef1f6", paddingVertical: 4 },
  cellWide: { flex: 3, paddingRight: 8 },
  cell: { flex: 1, textAlign: "right" },
  muted: { color: "#586174" },
  mark: { backgroundColor: "#fde4d6" },
  note: { padding: 10, borderRadius: 4, backgroundColor: "#f3f6fd", marginTop: 8 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 52,
    right: 52,
    fontSize: 8,
    color: "#586174",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

const pdfText = (text: string) => text.replace(/ /g, " ");
const percent = (value: number, locale: "fr" | "en") =>
  new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace(/ /g, " ");

function date(value: Date, locale: "fr" | "en", withTime: boolean): string {
  const text = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "medium" } : {}),
    timeZone: "UTC",
  }).format(value);
  return withTime ? `${text} UTC` : text;
}

/** Texte découpé en morceaux surlignés ou non (passages fusionnés s'ils se chevauchent). */
export function highlightSegments(
  text: string,
  matches: { start: number; end: number }[],
): { text: string; marked: boolean }[] {
  const segments: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    if (m.end <= cursor) continue;
    const start = Math.max(m.start, cursor);
    if (start > cursor) segments.push({ text: text.slice(cursor, start), marked: false });
    segments.push({ text: text.slice(start, m.end), marked: true });
    cursor = m.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
}

function AnalysisReport({
  data,
  labels,
}: {
  data: AnalysisReportData;
  labels: AnalysisReportLabels;
}) {
  const { plagiarism } = data;
  return (
    <Document title={labels.title} author="AltyDetect" language={data.locale}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>AltyDetect</Text>
        <Text style={styles.title}>{labels.title}</Text>
        <View style={styles.meta}>
          {[
            [labels.date, date(data.createdAt, data.locale, false)],
            [labels.timestamp, date(data.generatedAt, data.locale, true)],
            [labels.scope, data.scopeName],
            [labels.engine, data.engine],
          ].map(([label, value]) => (
            <View key={label}>
              <Text style={styles.metaLabel}>{label}</Text>
              <Text>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.h2}>{labels.plagiarism}</Text>
        <Text style={styles.label}>{labels.similarity}</Text>
        <Text style={styles.big}>{percent(plagiarism.similarity, data.locale)}</Text>
        <Text style={styles.label}>{labels.sources}</Text>
        {plagiarism.sources.length === 0 ? (
          <Text style={styles.muted}>{labels.noMatch}</Text>
        ) : (
          <View style={{ marginBottom: 14 }}>
            <View style={[styles.row, { borderBottom: "1 solid #dfe4ee" }]}>
              <Text style={[styles.cellWide, styles.muted]}>{labels.source}</Text>
              <Text style={[styles.cell, styles.muted]}>{labels.passages}</Text>
              <Text style={[styles.cell, styles.muted]}>{labels.bestScore}</Text>
            </View>
            {plagiarism.sources.map((source) => (
              <View key={source.label + (source.url ?? "")} style={styles.row} wrap={false}>
                <Text style={styles.cellWide}>{pdfText(source.url ?? source.label)}</Text>
                <Text style={styles.cell}>{source.passages}</Text>
                <Text style={styles.cell}>{percent(source.bestScore, data.locale)}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.label}>{labels.text}</Text>
        {plagiarism.text ? (
          <Text>
            {highlightSegments(pdfText(plagiarism.text), plagiarism.matches).map((segment, i) => (
              <Text key={i} style={segment.marked ? styles.mark : {}}>
                {segment.text}
              </Text>
            ))}
          </Text>
        ) : (
          <Text style={styles.muted}>{labels.textMissing}</Text>
        )}

        <Text style={[styles.h2, { marginTop: 18 }]}>{labels.detection}</Text>
        <Text style={styles.muted}>{labels.detectionPending}</Text>
        <Text style={styles.note}>{pdfText(labels.disclaimer)}</Text>

        <View style={styles.footer} fixed>
          <Text>{labels.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderAnalysisReport(
  data: AnalysisReportData,
  labels: AnalysisReportLabels,
): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<AnalysisReport data={data} labels={labels} />);
}
