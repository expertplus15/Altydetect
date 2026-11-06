/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Rapport PDF combiné d'une analyse : plagiat (phase 2) et détection de texte IA (phase 3).
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
  /** Libellés de la section détection (présents si data.detection l'est). */
  detect?: DetectionReportLabels;
}

export interface DetectionReportLabels {
  /** « Probablement IA », « Indéterminé », « Probablement humain ». */
  bands: Record<DetectionBand, string>;
  distribution: string;
  verdict: string;
  confidence: string;
  confidenceName: string;
  language: string;
  words: string;
  text: string;
  /** « Un détecteur donne une probabilité, pas une preuve… » (clé detect.disclaimer). */
  disclaimer: string;
}

export type DetectionBand = "likely_ai" | "undetermined" | "likely_human";

export interface AnalysisReportData {
  locale: "fr" | "en";
  /** Périmètre du plagiat ; null pour un rapport de détection seule. */
  scopeName: string | null;
  engine: string;
  createdAt: Date;
  generatedAt: Date;
  plagiarism?: {
    similarity: number;
    /** Texte analysé, transmis pour l'export seulement (jamais stocké) ; null s'il est absent. */
    text: string | null;
    matches: { start: number; end: number; sourceLabel: string }[];
    sources: { label: string; url: string | null; passages: number; bestScore: number }[];
  };
  detection?: {
    overall: { ai: number; undetermined: number; human: number };
    verdictBand: DetectionBand;
    languageName: string;
    wordCount: number;
    /** Texte analysé (export seulement, jamais stocké) ; null s'il est absent. */
    text: string | null;
    sentences: { start: number; end: number; band: DetectionBand }[];
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
  bar: { flexDirection: "row", height: 10, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  legend: { flexDirection: "row", gap: 14, marginBottom: 14, fontSize: 9 },
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

// Trois états qui diffèrent par la luminosité, pas seulement par la teinte (CLAUDE.md §8).
const BAND_BAR: Record<DetectionBand, string> = {
  likely_ai: "#c2410c",
  undetermined: "#9aa3b2",
  likely_human: "#1d4ed8",
};
const BAND_MARK: Record<DetectionBand, string> = {
  likely_ai: "#fde4d6",
  undetermined: "#eceff4",
  likely_human: "#dbe6ff",
};
const BANDS: DetectionBand[] = ["likely_ai", "undetermined", "likely_human"];
const SHARE_KEY = { likely_ai: "ai", undetermined: "undetermined", likely_human: "human" } as const;

/** Texte découpé par phrase, chaque phrase avec sa bande (null entre les phrases). */
export function bandSegments(
  text: string,
  sentences: { start: number; end: number; band: DetectionBand }[],
): { text: string; band: DetectionBand | null }[] {
  const segments: { text: string; band: DetectionBand | null }[] = [];
  let cursor = 0;
  for (const s of [...sentences].sort((a, b) => a.start - b.start)) {
    if (s.end <= cursor || s.start >= text.length) continue;
    const start = Math.max(s.start, cursor);
    if (start > cursor) segments.push({ text: text.slice(cursor, start), band: null });
    const end = Math.min(s.end, text.length);
    segments.push({ text: text.slice(start, end), band: s.band });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), band: null });
  return segments;
}

function DetectionSection({
  detection,
  labels,
  locale,
}: {
  detection: NonNullable<AnalysisReportData["detection"]>;
  labels: DetectionReportLabels;
  locale: "fr" | "en";
}) {
  return (
    <>
      <Text style={styles.label}>{labels.verdict}</Text>
      <Text style={[styles.big, { color: BAND_BAR[detection.verdictBand] }]}>
        {labels.bands[detection.verdictBand]}
      </Text>
      <View style={styles.meta}>
        {[
          [labels.confidence, labels.confidenceName],
          [labels.language, detection.languageName],
          [labels.words, String(detection.wordCount)],
        ].map(([label, value]) => (
          <View key={label}>
            <Text style={styles.metaLabel}>{label}</Text>
            <Text>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.label}>{labels.distribution}</Text>
      <View style={styles.bar}>
        {BANDS.map((band) => (
          <View
            key={band}
            style={{
              width: `${detection.overall[SHARE_KEY[band]] * 100}%`,
              backgroundColor: BAND_BAR[band],
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {BANDS.map((band) => (
          <Text key={band}>
            {labels.bands[band]} : {percent(detection.overall[SHARE_KEY[band]], locale)}
          </Text>
        ))}
      </View>
      {detection.text && (
        <>
          <Text style={styles.label}>{labels.text}</Text>
          <Text>
            {bandSegments(pdfText(detection.text), detection.sentences).map((segment, i) => (
              <Text
                key={i}
                style={segment.band ? { backgroundColor: BAND_MARK[segment.band] } : {}}
              >
                {segment.text}
              </Text>
            ))}
          </Text>
        </>
      )}
      <Text style={styles.note}>{pdfText(labels.disclaimer)}</Text>
    </>
  );
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
            ...(data.scopeName ? [[labels.scope, data.scopeName]] : []),
            [labels.engine, data.engine],
          ].map(([label, value]) => (
            <View key={label}>
              <Text style={styles.metaLabel}>{label}</Text>
              <Text>{value}</Text>
            </View>
          ))}
        </View>

        {plagiarism && (
          <>
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
                {highlightSegments(pdfText(plagiarism.text), plagiarism.matches).map(
                  (segment, i) => (
                    <Text key={i} style={segment.marked ? styles.mark : {}}>
                      {segment.text}
                    </Text>
                  ),
                )}
              </Text>
            ) : (
              <Text style={styles.muted}>{labels.textMissing}</Text>
            )}
            <Text style={styles.note}>{pdfText(labels.disclaimer)}</Text>
          </>
        )}

        <Text style={[styles.h2, { marginTop: 18 }]}>{labels.detection}</Text>
        {data.detection && labels.detect ? (
          <DetectionSection
            detection={data.detection}
            labels={labels.detect}
            locale={data.locale}
          />
        ) : (
          <Text style={styles.muted}>{labels.detectionPending}</Text>
        )}

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
