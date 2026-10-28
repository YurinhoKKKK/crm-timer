import ExcelJS from "exceljs";
import type { createClient } from "@/lib/supabase-server";
import { monthToDate } from "@/lib/followup";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// =====================================================================
// Exportação da Pontuação do Acompanhamento (.xlsx) — admin-only.
//
// Fonte única no banco: followup_scores_month (resumo por colaborador) +
// followup_scores_export (grão empresa × dia útil do mês) + followup_last_sync.
// A partir do grão montamos as abas de Grade diária, Por empresa e Registros.
// LGPD: nunca incluímos texto de mensagem — só horário da 1ª mensagem válida.
// =====================================================================

const TZ = "America/Sao_Paulo";

type DayColor = "verde" | "amarelo" | "vermelho" | "aguardando";

type SummaryRow = {
  collaboratorId: string | null;
  collaboratorName: string | null;
  points: number;
  aproveitamento: number;
  clienteDias: number;
  daysVerde: number;
  daysAmarelo: number;
  daysVermelho: number;
  companies: number;
};

type ExportRecord = {
  day: string; // YYYY-MM-DD
  companyId: string;
  companyName: string;
  groupName: string;
  responsibleId: string | null;
  responsibleName: string | null;
  firstMsgAt: string | null;
  contactColor: DayColor; // resultado do contato do dia
  color: DayColor; // cor do CLIENTE (a que pontua)
  recoveryNeed: number; // 0/1/2
  points: number;
  finalized: boolean;
};

export type PontuacaoExportData = {
  summary: SummaryRow[];
  records: ExportRecord[];
  lastSync: string | null;
};

// --- Carregamento ----------------------------------------------------------

export async function loadPontuacaoExport(
  supabase: SupabaseServer,
  month: string,
  consultant: string | null = null,
  collaborator: string | null = null,
  recovering = false
): Promise<PontuacaoExportData> {
  const p_month = monthToDate(month);
  const p_consultant = consultant;
  const p_collaborator = collaborator;
  const p_recovering = recovering;
  // As RPCs filtram por consultor/colaborador + "Em recuperação" (decisões 4) — e
  // sempre por "empresa com colaborador agora" (decisão 2 da 0156) por dentro.
  const [summaryRes, exportRes, syncRes] = await Promise.all([
    supabase.rpc("followup_scores_month", { p_month, p_consultant, p_collaborator, p_recovering }),
    supabase.rpc("followup_scores_export", { p_month, p_consultant, p_collaborator, p_recovering }),
    supabase.rpc("followup_last_sync"),
  ]);
  // As RPCs têm gate is_admin por dentro; um erro aqui (ex.: não-admin) sobe para
  // a rota, que responde o status adequado — nunca uma planilha vazia silenciosa.
  if (summaryRes.error) throw new Error(summaryRes.error.message);
  if (exportRes.error) throw new Error(exportRes.error.message);

  const summary: SummaryRow[] = (
    (summaryRes.data as
      | {
          collaborator_id: string | null;
          collaborator_name: string | null;
          points: number;
          client_days: number;
          aproveitamento: number | string | null;
          days_verde: number;
          days_amarelo: number;
          days_vermelho: number;
          companies: number;
        }[]
      | null) ?? []
  ).map((r) => ({
    collaboratorId: r.collaborator_id,
    collaboratorName: r.collaborator_name,
    points: Number(r.points),
    aproveitamento: r.aproveitamento === null ? 0 : Number(r.aproveitamento),
    clienteDias: Number(r.client_days),
    daysVerde: Number(r.days_verde),
    daysAmarelo: Number(r.days_amarelo),
    daysVermelho: Number(r.days_vermelho),
    companies: Number(r.companies),
  }));

  const records: ExportRecord[] = (
    (exportRes.data as
      | {
          d: string;
          company_id: string;
          company_name: string;
          group_name: string;
          responsible_id: string | null;
          responsible_name: string | null;
          first_msg_at: string | null;
          contact_color: DayColor;
          color: DayColor;
          recovery_need: number;
          points: number;
          finalized: boolean;
        }[]
      | null) ?? []
  ).map((r) => ({
    day: r.d,
    companyId: r.company_id,
    companyName: r.company_name,
    groupName: r.group_name,
    responsibleId: r.responsible_id,
    responsibleName: r.responsible_name,
    firstMsgAt: r.first_msg_at,
    contactColor: r.contact_color,
    color: r.color,
    recoveryNeed: Number(r.recovery_need),
    points: Number(r.points),
    finalized: r.finalized,
  }));

  return { summary, records, lastSync: (syncRes.data as string | null) ?? null };
}

// --- Estilo ----------------------------------------------------------------

const FONT = "Arial";
const HEADER_BG = "FF2B333B";
const HEADER_INK = "FFFFFFFF";
const BORDER = "FFDFDCDB";
const ACCENT = "FF3145FF";
const INK = "FF1F2937";
const SUBTLE = "FF667085";

const COLOR_FILL: Record<DayColor, { bg: string; ink: string }> = {
  verde: { bg: "FFD1FADF", ink: "FF05603A" },
  amarelo: { bg: "FFFEF0C7", ink: "FF93370D" },
  vermelho: { bg: "FFFEE4E2", ink: "FFB42318" },
  aguardando: { bg: "FFF2F4F7", ink: "FF475467" },
};

const COLOR_LABEL: Record<DayColor, string> = {
  verde: "Em dia",
  amarelo: "Atenção",
  vermelho: "Após 17h / sem contato",
  aguardando: "Aguardando",
};

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

// Número da coluna → letra (1=A, 27=AA) para montar fórmulas.
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Data pura "AAAA-MM-DD" → número de série do Excel (sem Date, sem fuso).
function excelSerialFromPureDate(iso: string): number {
  const [y, mo, d] = iso.split("-").map(Number);
  const yy = y - (mo <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468 + 25569;
}

function dayHeader(iso: string): string {
  const [, mo, d] = iso.split("-");
  return `${d}/${mo}`;
}

function weekdayPt(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    weekday: "short",
  });
}

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stampNow(): string {
  return new Date().toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stampSync(iso: string | null): string {
  if (!iso) return "sem sincronização registrada";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Estiliza uma linha de cabeçalho de tabela (fundo escuro, texto branco, Arial).
function paintHeader(ws: ExcelJS.Worksheet, rowNumber: number, fromCol: number, toCol: number) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = ws.getCell(rowNumber, c);
    cell.font = { name: FONT, bold: true, color: { argb: HEADER_INK }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle", horizontal: c === fromCol ? "left" : "center", wrapText: true };
    cell.border = allBorders;
  }
  ws.getRow(rowNumber).height = 24;
}

// --- Construção ------------------------------------------------------------

export async function buildPontuacaoWorkbook(
  data: PontuacaoExportData,
  month: string
): Promise<ExcelJS.Buffer> {
  const { summary, records, lastSync } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM Monvatti";
  wb.created = new Date();

  // Dias úteis do mês = dias distintos presentes no grão (já são dias úteis).
  const days = Array.from(new Set(records.map((r) => r.day))).sort();

  buildResumo(wb, summary, month, lastSync);
  buildGradeDiaria(wb, records, days);
  buildPorEmpresa(wb, records, days);
  buildRegistros(wb, records);
  buildRegras(wb);

  return wb.xlsx.writeBuffer();
}

// --- a) Resumo -------------------------------------------------------------

function buildResumo(
  wb: ExcelJS.Workbook,
  summary: SummaryRow[],
  month: string,
  lastSync: string | null
) {
  const ws = wb.addWorksheet("Resumo");
  const LAST_COL = 8;
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= LAST_COL; c++) ws.getColumn(c).width = 15;

  const title = ws.addRow(["Pontuação do Acompanhamento — Monvatti"]);
  ws.mergeCells(title.number, 1, title.number, LAST_COL);
  ws.getCell(title.number, 1).font = { name: FONT, bold: true, size: 16, color: { argb: ACCENT } };
  title.height = 26;

  const addInfo = (label: string) => {
    const r = ws.addRow([label]);
    ws.mergeCells(r.number, 1, r.number, LAST_COL);
    ws.getCell(r.number, 1).font = { name: FONT, size: 10, color: { argb: SUBTLE } };
  };
  addInfo(`Mês: ${monthTitle(month)}`);
  addInfo(`Gerado em: ${stampNow()}`);
  addInfo(`Última sincronização Digisac: ${stampSync(lastSync)}`);
  ws.addRow([]);

  const headerRow = ws.addRow(["Colaborador", "Aproveitamento", "Pontos", "Cliente-dias", "Dias verdes", "Dias amarelos", "Dias vermelhos", "Empresas"]);
  paintHeader(ws, headerRow.number, 1, LAST_COL);

  const people = summary.filter((s) => s.collaboratorId !== null);
  const orphan = summary.find((s) => s.collaboratorId === null) ?? null;

  const firstDataRow = headerRow.number + 1;
  const write = (name: string, s: SummaryRow, muted: boolean) => {
    const row = ws.addRow([name, s.aproveitamento, s.points, s.clienteDias, s.daysVerde, s.daysAmarelo, s.daysVermelho, s.companies]);
    for (let c = 1; c <= LAST_COL; c++) {
      const cell = ws.getCell(row.number, c);
      cell.font = { name: FONT, color: { argb: muted ? SUBTLE : INK }, italic: muted };
      cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center" };
      cell.border = allBorders;
    }
    ws.getCell(row.number, 2).numFmt = '0.0"%"'; // Aproveitamento
  };
  for (const p of people) write(p.collaboratorName || "(sem nome)", p, false);
  if (orphan) write("Sem responsável (não pontua)", orphan, true);

  const lastDataRow = ws.lastRow!.number;
  const totalRow = ws.addRow(["Total geral"]);
  const col = (n: number) => colLetter(n);
  ws.getCell(totalRow.number, 1).value = "Total geral";
  // Colunas 3..8 somam; Aproveitamento (col 2) é pontos_total ÷ cliente-dias_total.
  for (let c = 3; c <= LAST_COL; c++) {
    ws.getCell(totalRow.number, c).value = {
      formula: `SUM(${col(c)}${firstDataRow}:${col(c)}${lastDataRow})`,
    };
  }
  ws.getCell(totalRow.number, 2).value = {
    formula: `IF(${col(4)}${totalRow.number}=0,0,ROUND(${col(3)}${totalRow.number}/${col(4)}${totalRow.number}*100,1))`,
  };
  ws.getCell(totalRow.number, 2).numFmt = '0.0"%"';
  for (let c = 1; c <= LAST_COL; c++) {
    const cell = ws.getCell(totalRow.number, c);
    cell.font = { name: FONT, bold: true, color: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: c === 1 ? "left" : "center" };
    cell.border = { ...allBorders, top: { style: "medium", color: { argb: HEADER_BG } } };
  }

  ws.views = [{ state: "frozen", ySplit: headerRow.number }];
  ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: lastDataRow, column: LAST_COL } };
}

// --- b) Grade diária -------------------------------------------------------

function buildGradeDiaria(wb: ExcelJS.Workbook, records: ExportRecord[], days: string[]) {
  const ws = wb.addWorksheet("Grade diária");

  // Pontos por (responsável, dia) = soma das empresas.
  const NONE = "__none__";
  const names = new Map<string, string>();
  const byResp = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of records) {
    const key = r.responsibleId ?? NONE;
    names.set(key, r.responsibleId ? r.responsibleName || "(sem nome)" : "Sem responsável (não pontua)");
    const perDay = byResp.get(key) ?? new Map<string, number>();
    perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.points);
    byResp.set(key, perDay);
    totals.set(key, (totals.get(key) ?? 0) + r.points);
  }
  // Ordem: pontos desc; "Sem responsável" sempre por último.
  const keys = Array.from(byResp.keys()).sort((a, b) => {
    if (a === NONE) return 1;
    if (b === NONE) return -1;
    return (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
  });

  const DAY0 = 2; // 1ª coluna de dia
  const totalCol = DAY0 + days.length;
  ws.getColumn(1).width = 32;
  for (let i = 0; i < days.length; i++) ws.getColumn(DAY0 + i).width = 7;
  ws.getColumn(totalCol).width = 9;

  const headerRow = ws.addRow(["Colaborador", ...days.map(dayHeader), "Total"]);
  paintHeader(ws, headerRow.number, 1, totalCol);

  for (const key of keys) {
    const perDay = byResp.get(key)!;
    const row = ws.addRow([names.get(key)!]);
    const nameCell = ws.getCell(row.number, 1);
    nameCell.font = { name: FONT, color: { argb: key === NONE ? SUBTLE : INK }, italic: key === NONE };
    nameCell.alignment = { vertical: "middle" };
    nameCell.border = allBorders;
    days.forEach((d, i) => {
      const cell = ws.getCell(row.number, DAY0 + i);
      cell.border = allBorders;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { name: FONT, color: { argb: INK } };
      if (perDay.has(d)) {
        const pts = perDay.get(d)!;
        cell.value = pts;
        const tone: DayColor = pts > 0 ? "verde" : pts < 0 ? "vermelho" : "amarelo";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FILL[tone].bg } };
        cell.font = { name: FONT, color: { argb: COLOR_FILL[tone].ink } };
      }
    });
    const tCell = ws.getCell(row.number, totalCol);
    tCell.value = {
      formula: `SUM(${colLetter(DAY0)}${row.number}:${colLetter(totalCol - 1)}${row.number})`,
    };
    tCell.font = { name: FONT, bold: true, color: { argb: INK } };
    tCell.alignment = { vertical: "middle", horizontal: "center" };
    tCell.border = allBorders;
  }

  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow.number }];
  ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: totalCol } };
}

// --- c) Por empresa --------------------------------------------------------

function buildPorEmpresa(wb: ExcelJS.Workbook, records: ExportRecord[], days: string[]) {
  const ws = wb.addWorksheet("Por empresa");

  type Comp = {
    name: string;
    group: string;
    responsible: string;
    perDay: Map<string, { color: DayColor; firstMsgAt: string | null }>;
  };
  const comps = new Map<string, Comp>();
  const order: string[] = [];
  for (const r of records) {
    let c = comps.get(r.companyId);
    if (!c) {
      c = { name: r.companyName, group: r.groupName, responsible: "Sem responsável", perDay: new Map() };
      comps.set(r.companyId, c);
      order.push(r.companyId);
    }
    // records vêm ordenados por empresa, dia ⇒ o último visto é o mais recente.
    c.group = r.groupName;
    c.responsible = r.responsibleName || "Sem responsável";
    c.perDay.set(r.day, { color: r.color, firstMsgAt: r.firstMsgAt });
  }
  order.sort((a, b) => comps.get(a)!.name.localeCompare(comps.get(b)!.name, "pt-BR"));

  const DAY0 = 4;
  const vCol = DAY0 + days.length;
  const aCol = vCol + 1;
  const rCol = vCol + 2;
  const pCol = vCol + 3;
  ws.getColumn(1).width = 32; // Empresa
  ws.getColumn(2).width = 18; // Grupo
  ws.getColumn(3).width = 22; // Responsável
  for (let i = 0; i < days.length; i++) ws.getColumn(DAY0 + i).width = 7;
  ws.getColumn(vCol).width = 9;
  ws.getColumn(aCol).width = 9;
  ws.getColumn(rCol).width = 9;
  ws.getColumn(pCol).width = 9;

  const headerRow = ws.addRow([
    "Empresa", "Grupo", "Responsável",
    ...days.map(dayHeader),
    "Verdes", "Amarelos", "Vermelhos", "Pontos",
  ]);
  paintHeader(ws, headerRow.number, 1, pCol);

  for (const id of order) {
    const c = comps.get(id)!;
    const row = ws.addRow([c.name, c.group, c.responsible]);
    for (let col = 1; col <= 3; col++) {
      const cell = ws.getCell(row.number, col);
      cell.font = { name: FONT, color: { argb: INK }, bold: col === 1 };
      cell.alignment = { vertical: "middle" };
      cell.border = allBorders;
    }
    let nv = 0, na = 0, nr = 0;
    days.forEach((d, i) => {
      const cell = ws.getCell(row.number, DAY0 + i);
      cell.border = allBorders;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      const hit = c.perDay.get(d);
      if (hit) {
        cell.value = hhmm(hit.firstMsgAt);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FILL[hit.color].bg } };
        cell.font = { name: FONT, color: { argb: COLOR_FILL[hit.color].ink } };
        if (hit.color === "verde") nv++;
        else if (hit.color === "amarelo") na++;
        else if (hit.color === "vermelho") nr++;
      } else {
        cell.font = { name: FONT, color: { argb: INK } };
      }
    });
    const counts = [nv, na, nr];
    [vCol, aCol, rCol].forEach((col, i) => {
      const cell = ws.getCell(row.number, col);
      cell.value = counts[i];
      cell.font = { name: FONT, color: { argb: INK } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = allBorders;
    });
    // Pontos por FÓRMULA: verdes·(+1) + vermelhos·(−1).
    const pCell = ws.getCell(row.number, pCol);
    pCell.value = { formula: `${colLetter(vCol)}${row.number}-${colLetter(rCol)}${row.number}` };
    pCell.font = { name: FONT, bold: true, color: { argb: INK } };
    pCell.alignment = { vertical: "middle", horizontal: "center" };
    pCell.border = allBorders;
  }

  ws.views = [{ state: "frozen", xSplit: 3, ySplit: headerRow.number }];
  ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: pCol } };
}

// --- d) Registros ----------------------------------------------------------

function buildRegistros(wb: ExcelJS.Workbook, records: ExportRecord[]) {
  const ws = wb.addWorksheet("Registros");
  const LAST_COL = 10;
  ws.getColumn(1).width = 12; // Data
  ws.getColumn(2).width = 10; // Dia
  ws.getColumn(3).width = 32; // Empresa
  ws.getColumn(4).width = 18; // Grupo
  ws.getColumn(5).width = 22; // Responsável
  ws.getColumn(6).width = 12; // 1ª mensagem
  ws.getColumn(7).width = 20; // Contato do dia
  ws.getColumn(8).width = 22; // Cor do cliente
  ws.getColumn(9).width = 8; // Pontos
  ws.getColumn(10).width = 14; // Situação

  const headerRow = ws.addRow([
    "Data", "Dia", "Empresa", "Grupo no dia", "Responsável",
    "1ª mensagem", "Contato do dia", "Cor do cliente", "Pontos", "Situação",
  ]);
  paintHeader(ws, headerRow.number, 1, LAST_COL);

  for (const r of records) {
    const clienteLabel =
      COLOR_LABEL[r.color] + (r.recoveryNeed > 0 ? " (em recuperação)" : "");
    const row = ws.addRow([
      excelSerialFromPureDate(r.day),
      weekdayPt(r.day),
      r.companyName,
      r.groupName,
      r.responsibleName || "Sem responsável",
      hhmm(r.firstMsgAt),
      COLOR_LABEL[r.contactColor],
      clienteLabel,
      r.points,
      r.finalized ? "Consolidado" : "Em andamento",
    ]);
    for (let c = 1; c <= LAST_COL; c++) {
      const cell = ws.getCell(row.number, c);
      cell.font = { name: FONT, color: { argb: INK } };
      cell.alignment = { vertical: "middle", horizontal: c === 3 || c === 4 || c === 5 ? "left" : "center" };
      cell.border = allBorders;
    }
    ws.getCell(row.number, 1).numFmt = "dd/mm/yyyy";
    // Col 7 = contato do dia; col 8 = cor do cliente — cada uma com seu preenchimento.
    const contactCell = ws.getCell(row.number, 7);
    contactCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FILL[r.contactColor].bg } };
    contactCell.font = { name: FONT, color: { argb: COLOR_FILL[r.contactColor].ink } };
    const clientCell = ws.getCell(row.number, 8);
    clientCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FILL[r.color].bg } };
    clientCell.font = { name: FONT, color: { argb: COLOR_FILL[r.color].ink } };
  }

  ws.views = [{ state: "frozen", ySplit: headerRow.number }];
  ws.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: LAST_COL },
  };
}

// --- e) Regras -------------------------------------------------------------

function buildRegras(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Regras");
  ws.getColumn(1).width = 100;

  const title = ws.addRow(["Como a pontuação é calculada"]);
  ws.getCell(title.number, 1).font = { name: FONT, bold: true, size: 14, color: { argb: ACCENT } };
  ws.addRow([]);

  const lines: string[] = [
    "Contato do dia pela 1ª mensagem válida (horário de Brasília):",
    "   • Antes das 12:00 → verde",
    "   • Das 12:00 às 16:59 → amarelo",
    "   • A partir das 17:00, ou nenhuma mensagem no dia → vermelho",
    "   • Dia corrente ainda sem contato antes das 17:00 → aguardando (não é falta)",
    "",
    "Cor do cliente (semáforo de recuperação) — a partir de 26/10/2026:",
    "   • Um dia vermelho zera a saúde: o cliente passa a precisar de 2 contatos de manhã (verdes) para voltar ao normal.",
    "   • Durante a recuperação, um contato de manhã conta como 1 verde; contato à tarde mantém; nenhum/à noite recomeça a recuperação.",
    "   • 1º verde na recuperação → cliente fica amarelo (ainda falta 1); 2º verde → cliente volta ao verde.",
    "",
    "Pontos seguem a COR DO CLIENTE: verde = +1, vermelho = −1, amarelo/recuperação/aguardando = 0.",
    "A coluna 'Contato do dia' mostra o resultado cru do contato; 'Cor do cliente' é a cor que pontua.",
    "",
    "Só contam dias úteis (segunda a sexta), excluindo feriados nacionais. Sábado, domingo e feriado não pontuam nem viram falta; a recuperação continua do último dia útil, sem expirar.",
    "O ponto do dia vai para o colaborador responsável pela empresa naquele dia. Empresa sem responsável não entra.",
    "Mensagens em massa (a mesma pessoa enviando para 5 ou mais contatos distintos em 60 segundos) não contam como contato.",
    "Mensagens de robôs/automação e comentários internos não contam.",
    "Empresas consideradas = as que estavam em Ativos ou Ema no dia (reconstruído pelo histórico de grupos) e têm colaborador responsável.",
    "",
    "Observação: setembro e outubro/2026 usam o responsável ATUAL de cada empresa. Linhas até 25/10/2026 mantêm a regra antiga (cor do cliente = contato do dia).",
    "LGPD: esta planilha nunca inclui o texto das mensagens — apenas o horário da 1ª mensagem válida.",
  ];
  for (const text of lines) {
    const r = ws.addRow([text]);
    const cell = ws.getCell(r.number, 1);
    cell.font = { name: FONT, size: 11, color: { argb: text ? INK : SUBTLE }, bold: text.endsWith(":") };
    cell.alignment = { vertical: "middle", wrapText: true };
  }
}

// Nome do arquivo: pontuacao-acompanhamento-AAAA-MM.xlsx.
export function pontuacaoExportFilename(month: string): string {
  return `pontuacao-acompanhamento-${month}.xlsx`;
}
