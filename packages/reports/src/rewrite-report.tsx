/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Pragmas : JSX automatique aussi quand le fichier est compilé hors de ce package (worker tsx).
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { registerFonts } from "./fonts";

// Rapport PDF d'une réécriture : original, proposition retenue, registre, intensité, date et
// horodatage. Les libellés sont fournis par l'application (traduits par next-intl).

export interface RewriteReportLabels {
  title: string;
  original: string;
  proposal: string;
  register: string;
  intensity: string;
  date: string;
  timestamp: string;
  originalMissing: string;
  footer: string;
}

export interface RewriteReportData {
  locale: "fr" | "en";
  /** Texte d'origine, transmis pour l'export seulement (jamais stocké) ; null s'il est absent. */
  original: string | null;
  proposal: string;
  changesSummary: string;
  registerName: string;
  intensityName: string;
  /** Date de la réécriture. */
  createdAt: Date;
  /** Date de génération du rapport. */
  generatedAt: Date;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10.5,
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
  metaItem: { flexDirection: "column", gap: 2 },
  metaLabel: { fontSize: 8, color: "#586174", textTransform: "uppercase", letterSpacing: 0.6 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 600,
    color: "#586174",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  body: { fontSize: 10.5 },
  muted: { color: "#586174" },
  proposal: { padding: 12, borderRadius: 4, backgroundColor: "#f3f6fd", border: "1 solid #c8d6f7" },
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

function format(date: Date, locale: "fr" | "en", withTime: boolean): string {
  const text = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "medium" } : {}),
    timeZone: "UTC",
  }).format(date);
  return withTime ? `${text} UTC` : text;
}

/** Espaces fines insécables remplacées : la police du PDF ne les dessine pas. */
const pdfText = (text: string) => text.replace(/ /g, " ");

function RewriteReport({ data, labels }: { data: RewriteReportData; labels: RewriteReportLabels }) {
  const paragraphs = (text: string) =>
    pdfText(text)
      .split(/\n{2,}/)
      .map((paragraph, index) => (
        <Text key={index} style={[styles.body, { marginBottom: 6 }]}>
          {paragraph}
        </Text>
      ));
  return (
    <Document title={labels.title} author="AltyDetect" language={data.locale}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>AltyDetect</Text>
        <Text style={styles.title}>{labels.title}</Text>
        <View style={styles.meta}>
          {[
            [labels.register, data.registerName],
            [labels.intensity, data.intensityName],
            [labels.date, format(data.createdAt, data.locale, false)],
            [labels.timestamp, format(data.generatedAt, data.locale, true)],
          ].map(([label, value]) => (
            <View key={label} style={styles.metaItem}>
              <Text style={styles.metaLabel}>{label}</Text>
              <Text>{pdfText(value ?? "")}</Text>
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.original}</Text>
          {data.original ? (
            paragraphs(data.original)
          ) : (
            <Text style={styles.muted}>{labels.originalMissing}</Text>
          )}
        </View>
        <View style={styles.section} wrap>
          <Text style={styles.sectionTitle}>{labels.proposal}</Text>
          <View style={styles.proposal}>
            {paragraphs(data.proposal)}
            {data.changesSummary ? (
              <Text style={[styles.muted, { marginTop: 4 }]}>{pdfText(data.changesSummary)}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.footer} fixed>
          <Text>{labels.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderRewriteReport(
  data: RewriteReportData,
  labels: RewriteReportLabels,
): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<RewriteReport data={data} labels={labels} />);
}
