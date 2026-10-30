import ExcelJS from "exceljs";
import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";
import { loadAtrasosList, type LoadAtrasosInput } from "@/app/admin/atrasos/actions";
import {
  CELL_SITUATION_META,
  displayTypeLabel,
  formatSpan,
  type AtrasoRow,
  type CellRow,
  type SituationKey,
} from "@/app/admin/atrasos/atrasos-shared";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// =====================================================================
// Exportação da auditoria de ATRASOS em Excel (.xlsx) — admin-only.
// Três abas, com os MESMOS filtros aplicados na tela: Lista, Por criador e Por
// responsável. Os dados saem das RPCs 0166 (atrasos_list / atrasos_summary),
// agregados no banco (nunca consulta por linha).
// =====================================================================

const INK = "FF1F2937";
const HEADER_BG = "FF2B333B";
const HEADER_INK = "FFFFFFFF";
const LINE = "FFE5E7EB";

const SITUATION_SHORT: Record<SituationKey, string> = {
  completed_late: "Concluída com atraso",
  open_overdue: "Atrasada em aberto",
  expired: "Expirada",
};

function brtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type SummaryExportPerson = {
  name: string;
  total: number;
  onTimePct: number;
  completedLate: number;
  openOverdue: number;
  expired: number;
  medianDelaySeconds: number;
  under24Late?: number;
};

type RawSummaryPerson = {
  id: string;
  total: number;
  late: number;
  on_time_pct: number;
  completed_late: number;
  open_overdue: number;
  expired: number;
  median_delay_seconds: number;
  under24_late?: number;
};

export async function loadAtrasosExportData(
  supabase: SupabaseServer,
  input: Omit<LoadAtrasosInput, "limit" | "offset">
): Promise<{
  rows: AtrasoRow[];
  creators: SummaryExportPerson[];
  responsibles: SummaryExportPerson[];
}> {
  const [listRes, { data: summaryData }] = await Promise.all([
    // Teto alto: a auditoria de um período costuma caber bem abaixo disso; se
    // crescer muito, o export reflete o mesmo recorte visível na tela.
    loadAtrasosList({ ...input, limit: 5000, offset: 0 }),
    supabase.rpc("atrasos_summary", {
      p_start: input.start,
      p_end: input.end,
      p_include_standard: input.includeStandard,
      p_status: input.status || null,
      p_creator: input.creatorId || null,
      p_responsible: input.responsibleId || null,
      p_company: input.companyId || null,
      p_type: input.type || null,
      p_search: input.search.trim() || null,
    }),
  ]);

  const summary = (summaryData as {
    creators: RawSummaryPerson[];
    responsibles: RawSummaryPerson[];
  } | null) ?? { creators: [], responsibles: [] };

  const people = await resolvePeople(supabase, [
    ...summary.creators.map((r) => r.id),
    ...summary.responsibles.map((r) => r.id),
  ]);
  const enrich = (r: RawSummaryPerson): SummaryExportPerson => ({
    name: people.get(r.id)?.name ?? "(sem nome)",
    total: Number(r.total),
    onTimePct: Number(r.on_time_pct ?? 0),
    completedLate: Number(r.completed_late),
    openOverdue: Number(r.open_overdue),
    expired: Number(r.expired),
    medianDelaySeconds: Number(r.median_delay_seconds ?? 0),
    under24Late: r.under24_late == null ? undefined : Number(r.under24_late),
  });

  return {
    rows: listRes.rows,
    creators: summary.creators.map(enrich),
    responsibles: summary.responsibles.map(enrich),
  };
}

function styleHeader(row: ExcelJS.Row, lastCol: number) {
  row.height = 20;
  for (let col = 1; col <= lastCol; col++) {
    const cell = row.getCell(col);
    cell.font = { bold: true, color: { argb: HEADER_INK }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: LINE } },
      bottom: { style: "thin", color: { argb: LINE } },
      left: { style: "thin", color: { argb: LINE } },
      right: { style: "thin", color: { argb: LINE } },
    };
  }
}

export async function buildAtrasosWorkbook(data: {
  rows: AtrasoRow[];
  creators: SummaryExportPerson[];
  responsibles: SummaryExportPerson[];
  periodLabel: string;
}): Promise<ExcelJS.Buffer> {
  const { rows, creators, responsibles, periodLabel } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM Monvatti";
  wb.created = new Date();

  // --- Aba Lista ---
  const ws = wb.addWorksheet("Lista");
  const listHeaders = [
    "Empresa", "Tarefa / Tipo", "Responsável", "Criador", "Criada em",
    "Prazo", "Prazo concedido", "Concluída em", "Atraso", "Situação",
  ];
  const widths = [30, 26, 22, 22, 17, 17, 16, 17, 14, 22];
  ws.columns = widths.map((w) => ({ width: w }));
  const title = ws.addRow([`Auditoria de atrasos — ${periodLabel}`]);
  ws.mergeCells(title.number, 1, title.number, listHeaders.length);
  title.getCell(1).font = { bold: true, size: 14, color: { argb: INK } };
  ws.addRow([]);
  styleHeader(ws.addRow(listHeaders), listHeaders.length);
  for (const r of rows) {
    ws.addRow([
      r.companyName,
      displayTypeLabel(r.typeKey, r.typeLabel),
      r.responsible.name,
      r.creator.name ?? "Sistema",
      brtDateTime(r.createdAt),
      brtDateTime(r.dueAt),
      formatSpan(r.grantedSeconds),
      brtDateTime(r.finishedAt),
      formatSpan(r.delaySeconds),
      SITUATION_SHORT[r.situation],
    ]);
  }
  ws.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: listHeaders.length },
  };
  ws.views = [{ state: "frozen", ySplit: 3 }];

  // --- Aba Por criador ---
  const wc = wb.addWorksheet("Por criador");
  const creatorHeaders = [
    "Criador", "Tarefas", "% no prazo", "Concluídas com atraso",
    "Atrasadas em aberto", "Expiradas", "Atraso mediano", "Prazo < 24h",
  ];
  wc.columns = [26, 10, 11, 20, 18, 11, 16, 12].map((w) => ({ width: w }));
  styleHeader(wc.addRow(creatorHeaders), creatorHeaders.length);
  for (const p of creators) {
    wc.addRow([
      p.name, p.total, p.onTimePct / 100, p.completedLate, p.openOverdue,
      p.expired, p.completedLate > 0 ? formatSpan(p.medianDelaySeconds) : "—",
      p.under24Late ?? 0,
    ]);
  }
  wc.getColumn(3).numFmt = "0%";
  wc.views = [{ state: "frozen", ySplit: 1 }];

  // --- Aba Por responsável ---
  const wr = wb.addWorksheet("Por responsável");
  const respHeaders = [
    "Responsável", "Tarefas", "% no prazo", "Concluídas com atraso",
    "Atrasadas em aberto", "Expiradas", "Atraso mediano",
  ];
  wr.columns = [26, 10, 11, 20, 18, 11, 16].map((w) => ({ width: w }));
  styleHeader(wr.addRow(respHeaders), respHeaders.length);
  for (const p of responsibles) {
    wr.addRow([
      p.name, p.total, p.onTimePct / 100, p.completedLate, p.openOverdue,
      p.expired, p.completedLate > 0 ? formatSpan(p.medianDelaySeconds) : "—",
    ]);
  }
  wr.getColumn(3).numFmt = "0%";
  wr.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

export function atrasosExportFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `atrasos-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`;
}

// --- Export do recorte de UMA célula (drill-down) --------------------------
export async function buildAtrasosCellWorkbook(data: {
  rows: CellRow[];
  heading: string; // ex.: "Mateus Borges · Concluídas com atraso (52)"
}): Promise<ExcelJS.Buffer> {
  const { rows, heading } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM Monvatti";
  wb.created = new Date();
  const ws = wb.addWorksheet("Tarefas");
  const headers = [
    "Empresa", "Tarefa / Tipo", "Responsável", "Criador", "Criada em",
    "Prazo", "Prazo concedido", "Concluída em", "Atraso", "Situação",
  ];
  ws.columns = [30, 26, 22, 22, 17, 17, 16, 17, 14, 22].map((w) => ({ width: w }));
  const title = ws.addRow([heading]);
  ws.mergeCells(title.number, 1, title.number, headers.length);
  title.getCell(1).font = { bold: true, size: 14, color: { argb: INK } };
  ws.addRow([]);
  styleHeader(ws.addRow(headers), headers.length);
  for (const r of rows) {
    ws.addRow([
      r.companyName,
      displayTypeLabel(r.typeKey, r.typeLabel),
      r.responsible.name,
      r.creator.name ?? "Sistema",
      brtDateTime(r.createdAt),
      brtDateTime(r.dueAt),
      formatSpan(r.grantedSeconds),
      brtDateTime(r.finishedAt),
      r.delaySeconds == null ? "—" : formatSpan(r.delaySeconds),
      CELL_SITUATION_META[r.situation].label,
    ]);
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
  ws.views = [{ state: "frozen", ySplit: 3 }];
  return wb.xlsx.writeBuffer();
}
