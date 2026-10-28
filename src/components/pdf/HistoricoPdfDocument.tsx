import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  pdfText,
  brtDateTime,
  brtDateBR,
  type PdfBlock,
  type PdfRun,
  type TimelineEntry,
  type TimelineGroup,
} from "@/lib/historico-pdf-build";

// Documento PDF do Histórico da empresa (uso interno). A4 retrato, paleta
// Monvatti, fontes PADRÃO do PDF (Helvetica) — os acentos do português são
// cobertos por WinAnsi; o texto já chega higienizado por pdfText(). Linha do
// tempo em ordem cronológica, agrupada por mês. Rodapé fixo com "Página X de Y".
//
// DOIS cuidados por bugs do @react-pdf/pdfkit (que estouram "unsupported
// number" em alguns layouts):
//   1) NÃO usar propriedades `border*` — todas as linhas/filetes são Views
//      PREENCHIDAS (backgroundColor); um retângulo fino não passa pelo caminho
//      de clip de borda.
//   2) NÃO usar rodapé `fixed` com `render` (numeração de página): em documentos
//      longos (muitas páginas) o `render` em elemento fixo estoura. O rodapé
//      ("Documento interno…" + "Página X de Y") é carimbado DEPOIS, página a
//      página, com o pdf-lib (ver stampHistoricoFooter em historico-pdf-build).
//      Por isso a página reserva `paddingBottom` para o rodapé caber.

export type CoverInfo = {
  companyName: string;
  groupName: string | null;
  consultants: string[];
  collaborators: string[];
  entryDateISO: string | null;
  periodLabel: string;
  generatedBy: string;
  generatedAtStamp: string;
};

// Paleta Monvatti.
const BLUE = "#3145FF";
const INK = "#2B333B";
const LINE = "#DFDCDB";
const BG = "#F5F5F4";
const TINT = "#E8EBFF"; // azul bem claro (chip "Visível ao cliente")
const MUTED = "#6B7280";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    paddingTop: 40,
    paddingBottom: 54,
    paddingHorizontal: 44,
    lineHeight: 1.4,
  },
  rule: { height: 1, backgroundColor: LINE, width: "100%" },
  // --- Capa / cabeçalho ---
  overline: {
    fontSize: 8,
    letterSpacing: 1.5,
    color: BLUE,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  companyName: {
    fontSize: 16,
    lineHeight: 1.3,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginBottom: 12,
  },
  metaGrid: { paddingVertical: 10 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: {
    width: 120,
    fontSize: 9,
    color: MUTED,
    fontFamily: "Helvetica-Bold",
  },
  metaValue: { flex: 1, fontSize: 9, color: INK },
  // --- Mês ---
  monthHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: BLUE,
    marginTop: 14,
    marginBottom: 3,
  },
  monthRule: { height: 1.5, width: 40, backgroundColor: BLUE, marginBottom: 10 },
  // --- Entrada da linha do tempo ---
  entry: { flexDirection: "row", marginBottom: 12 },
  dotCol: { width: 10, alignItems: "center", paddingTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: BLUE },
  entryBody: { flex: 1 },
  entryMeta: { flexDirection: "row", flexWrap: "wrap", marginBottom: 3 },
  metaTime: { fontSize: 8.5, color: INK, fontFamily: "Helvetica-Bold" },
  metaSep: { fontSize: 8.5, color: LINE, marginHorizontal: 4 },
  metaType: { fontSize: 8.5, color: BLUE, fontFamily: "Helvetica-Bold" },
  metaAuthor: { fontSize: 8.5, color: MUTED },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 3 },
  tag: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: INK,
    backgroundColor: BG,
    borderRadius: 3,
    paddingVertical: 1,
    paddingHorizontal: 4,
    marginRight: 4,
    marginBottom: 2,
  },
  tagClient: { color: BLUE, backgroundColor: TINT },
  body: { fontSize: 9.5, color: INK },
  // blocos de anotação
  paragraph: { fontSize: 9.5, color: INK, marginBottom: 3 },
  heading: { fontFamily: "Helvetica-Bold", color: INK, marginBottom: 3, marginTop: 2 },
  quoteRow: { flexDirection: "row", marginBottom: 3 },
  quoteBar: { width: 2, backgroundColor: LINE, marginRight: 6 },
  quoteText: { flex: 1, fontSize: 9.5, color: MUTED, fontStyle: "italic" },
  listRow: { flexDirection: "row", marginBottom: 2 },
  listMarker: { width: 16, fontSize: 9.5, color: INK },
  listContent: { flex: 1, fontSize: 9.5, color: INK },
  attachments: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  empty: { fontSize: 11, color: MUTED, marginTop: 30, textAlign: "center" },
});

function runStyle(r: PdfRun) {
  const s: Record<string, string | number> = {};
  if (r.bold) s.fontFamily = r.italic ? "Helvetica-BoldOblique" : "Helvetica-Bold";
  else if (r.italic) s.fontFamily = "Helvetica-Oblique";
  if (r.underline || r.link) s.textDecoration = "underline";
  if (r.link) s.color = BLUE;
  return s;
}

function Runs({ runs }: { runs: PdfRun[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <Text key={i} style={runStyle(r)}>
          {pdfText(r.text)}
        </Text>
      ))}
    </>
  );
}

function NoteBlock({ block }: { block: PdfBlock }) {
  if (block.type === "listitem") {
    const marker = block.ordered ? `${block.index ?? 1}.` : "•";
    const indent = ((block.level ?? 1) - 1) * 12;
    return (
      <View style={[styles.listRow, { marginLeft: indent }]}>
        <Text style={styles.listMarker}>{marker}</Text>
        <Text style={styles.listContent}>
          <Runs runs={block.runs} />
        </Text>
      </View>
    );
  }
  if (block.type === "heading") {
    const size = block.headingLevel && block.headingLevel <= 2 ? 11 : 10;
    return (
      <Text style={[styles.heading, { fontSize: size }]}>
        <Runs runs={block.runs} />
      </Text>
    );
  }
  if (block.type === "blockquote") {
    return (
      <View style={styles.quoteRow}>
        <View style={styles.quoteBar} />
        <Text style={styles.quoteText}>
          <Runs runs={block.runs} />
        </Text>
      </View>
    );
  }
  return (
    <Text style={styles.paragraph}>
      <Runs runs={block.runs} />
    </Text>
  );
}

function Entry({ entry }: { entry: TimelineEntry }) {
  const isNote = entry.kind === "note";
  return (
    <View style={styles.entry}>
      <View style={styles.dotCol}>
        <View style={styles.dot} />
      </View>
      <View style={styles.entryBody}>
        <View style={styles.entryMeta}>
          <Text style={styles.metaTime}>{brtDateTime(entry.at)}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaType}>
            {isNote ? "Anotação" : pdfText(entry.typeLabel)}
          </Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaAuthor}>{pdfText(entry.authorName)}</Text>
        </View>

        {isNote ? (
          <>
            <View style={styles.tagsRow}>
              <Text style={[styles.tag, entry.visibleToClient ? styles.tagClient : {}]}>
                {entry.visibleToClient ? "Visível ao cliente" : "Interna"}
              </Text>
              {entry.areas.map((a, i) => (
                <Text
                  key={i}
                  style={[styles.tag, { backgroundColor: a.bg, color: a.fg }]}
                >
                  {pdfText(a.label)}
                </Text>
              ))}
              {entry.edited ? <Text style={styles.tag}>Editada</Text> : null}
            </View>
            {entry.blocks.length > 0 ? (
              entry.blocks.map((b, i) => <NoteBlock key={i} block={b} />)
            ) : (
              <Text style={styles.paragraph}>(sem conteúdo)</Text>
            )}
            {entry.attachments.length > 0 && (
              <Text style={styles.attachments}>
                Anexos: {entry.attachments.map((n) => pdfText(n)).join(", ")}
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.body}>{pdfText(entry.content) || "(sem detalhe)"}</Text>
        )}
      </View>
    </View>
  );
}

export default function HistoricoPdfDocument({
  cover,
  groups,
}: {
  cover: CoverInfo;
  groups: TimelineGroup[];
}) {
  const consultants = cover.consultants.length
    ? cover.consultants.map((n) => pdfText(n)).join(", ")
    : "—";
  const collaborators = cover.collaborators.length
    ? cover.collaborators.map((n) => pdfText(n)).join(", ")
    : "—";

  return (
    <Document
      title={`Histórico — ${pdfText(cover.companyName)}`}
      author={pdfText(cover.generatedBy)}
    >
      <Page size="A4" style={styles.page}>
        {/* O rodapé (linha + "Documento interno…" + "Página X de Y") é
            carimbado depois pelo pdf-lib — ver stampHistoricoFooter. */}

        {/* Capa / cabeçalho */}
        <Text style={styles.overline}>HISTÓRICO DA EMPRESA</Text>
        <Text style={styles.companyName}>{pdfText(cover.companyName)}</Text>
        <View style={styles.rule} />
        <View style={styles.metaGrid}>
          <MetaRow label="Grupo atual" value={pdfText(cover.groupName) || "—"} />
          <MetaRow label="Consultores" value={consultants} />
          <MetaRow label="Colaboradores" value={collaborators} />
          <MetaRow
            label="Data de entrada"
            value={cover.entryDateISO ? brtDateBR(cover.entryDateISO) : "—"}
          />
          <MetaRow label="Período exportado" value={pdfText(cover.periodLabel)} />
          <MetaRow
            label="Gerado por"
            value={`${pdfText(cover.generatedBy)} em ${cover.generatedAtStamp}`}
          />
        </View>
        <View style={styles.rule} />

        {/* Linha do tempo */}
        {groups.length === 0 ? (
          <Text style={styles.empty}>
            Nenhum registro no período selecionado.
          </Text>
        ) : (
          groups.map((g, gi) => (
            <View key={gi}>
              <Text style={styles.monthHeading}>{pdfText(g.heading)}</Text>
              <View style={styles.monthRule} />
              {g.entries.map((e, ei) => (
                <Entry key={ei} entry={e} />
              ))}
            </View>
          ))
        )}
      </Page>
    </Document>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}
