import ExcelJS from "exceljs";

// =====================================================================
// Exportação da CALIBRAÇÃO de atendimento em Excel (.xlsx) — admin-only.
// Duas abas:
//   • Resumo  — totais por pessoa e por pessoa×empresa (base da comparação).
//   • Detalhe — uma linha por (pessoa, empresa, dia), minutos e se foi
//               encerrado automaticamente (para o script de diagnóstico).
// Minutos como NÚMERO (soma no Excel); dia como DATA real; auto_closed à parte.
// =====================================================================

export type AttendanceExportRow = {
  user_name: string;
  company_number: string | null;
  company_name: string;
  bucket: string; // "AAAA-MM-DD" (nível de dia)
  minutes: number;
  auto_closed: boolean;
  entries: number;
};

// Data pura "AAAA-MM-DD" → número de série do Excel (sem Date, sem fuso).
function excelSerialFromPureDate(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const yy = y - (mo <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const daysSinceUnixEpoch = era * 146097 + doe - 719468;
  return daysSinceUnixEpoch + 25569;
}

const INK = "FF1F2937";
const HEADER_BG = "FF2B333B";
const HEADER_INK = "FFFFFFFF";
const LINE = "FFE5E7EB";
const BAND_BG = "FFEEF2F7";
const AUTO_BG = "FFFEF3C7"; // âmbar claro p/ auto-encerrado
const AUTO_INK = "FF92400E";

const num = (v: unknown) => Number(v) || 0;
const companyLabel = (r: { company_number: string | null; company_name: string }) =>
  r.company_number ? `${r.company_number} — ${r.company_name}` : r.company_name;

export function buildAttendanceWorkbook(
  rows: AttendanceExportRow[],
  meta: { periodLabel: string }
): Promise<ExcelJS.Buffer> {
  const thin = { style: "thin" as const, color: { argb: LINE } };
  const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

  const clean = rows.filter((r) => !r.auto_closed);
  const auto = rows.filter((r) => r.auto_closed);

  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM Monvatti";
  wb.created = new Date();
  const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // --- helpers de cabeçalho/título reaproveitados nas duas abas ---
  function titleBlock(ws: ExcelJS.Worksheet, lastCol: number, subtitle: string) {
    const t = ws.addRow(["Calibração de atendimento — Monvatti"]);
    ws.mergeCells(t.number, 1, t.number, lastCol);
    const tc = ws.getCell(t.number, 1);
    tc.font = { bold: true, size: 16, color: { argb: INK } };
    tc.alignment = { vertical: "middle" };
    t.height = 26;

    const s = ws.addRow([subtitle]);
    ws.mergeCells(s.number, 1, s.number, lastCol);
    ws.getCell(s.number, 1).font = { italic: true, size: 10, color: { argb: "FF6B7280" } };
    ws.addRow([]);
  }
  function headerRow(ws: ExcelJS.Worksheet, labels: string[], centerFrom = 99) {
    const hr = ws.addRow(labels);
    hr.height = 22;
    for (let c = 1; c <= labels.length; c++) {
      const cell = ws.getCell(hr.number, c);
      cell.font = { bold: true, color: { argb: HEADER_INK }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.alignment = { vertical: "middle", horizontal: c >= centerFrom ? "center" : "left" };
      cell.border = allBorders;
    }
    return hr;
  }

  // ===================== Aba 1: Resumo =====================
  {
    const ws = wb.addWorksheet("Resumo");
    ws.getColumn(1).width = 30; // Pessoa
    ws.getColumn(2).width = 40; // Empresa
    ws.getColumn(3).width = 14; // Atendimentos
    ws.getColumn(4).width = 16; // Minutos
    ws.getColumn(5).width = 12; // Horas
    titleBlock(ws, 5, `Exportado em ${stamp} · período: ${meta.periodLabel}`);

    // Totais por pessoa (encerrados pela pessoa) + auto à parte.
    type P = { name: string; min: number; entries: number; autoMin: number };
    const pm = new Map<string, P>();
    for (const r of rows) {
      const p = pm.get(r.user_name) ?? { name: r.user_name, min: 0, entries: 0, autoMin: 0 };
      if (r.auto_closed) p.autoMin += num(r.minutes);
      else {
        p.min += num(r.minutes);
        p.entries += num(r.entries);
      }
      pm.set(r.user_name, p);
    }
    const people = Array.from(pm.values()).sort((a, b) => b.min - a.min);

    const secA = ws.addRow(["Por pessoa (encerrados pela pessoa)"]);
    ws.mergeCells(secA.number, 1, secA.number, 5);
    ws.getCell(secA.number, 1).font = { bold: true, size: 12, color: { argb: INK } };
    ws.getCell(secA.number, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_BG } };
    secA.height = 20;

    headerRow(ws, ["Pessoa", "", "Atendimentos", "Minutos", "Horas"], 3);
    for (const p of people) {
      const row = ws.addRow([p.name, "", p.entries, Math.round(p.min), p.min / 60]);
      row.getCell(1).font = { bold: true, color: { argb: INK } };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(5).numFmt = "0.0";
      row.getCell(5).alignment = { horizontal: "center" };
      for (let c = 1; c <= 5; c++) row.getCell(c).border = allBorders;
    }

    ws.addRow([]);

    // Por pessoa × empresa (só encerrados pela pessoa = base da comparação).
    const secB = ws.addRow(["Por pessoa e empresa"]);
    ws.mergeCells(secB.number, 1, secB.number, 5);
    ws.getCell(secB.number, 1).font = { bold: true, size: 12, color: { argb: INK } };
    ws.getCell(secB.number, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_BG } };
    secB.height = 20;

    const hrB = headerRow(ws, ["Pessoa", "Empresa", "Atendimentos", "Minutos", "Horas"], 3);
    type PC = { name: string; label: string; min: number; entries: number };
    const pcm = new Map<string, PC>();
    for (const r of clean) {
      const key = `${r.user_name}||${r.company_number ?? ""}||${r.company_name}`;
      const pc = pcm.get(key) ?? { name: r.user_name, label: companyLabel(r), min: 0, entries: 0 };
      pc.min += num(r.minutes);
      pc.entries += num(r.entries);
      pcm.set(key, pc);
    }
    const pcList = Array.from(pcm.values()).sort(
      (a, b) => a.name.localeCompare(b.name, "pt-BR") || b.min - a.min
    );
    const firstDataB = hrB.number + 1;
    for (const pc of pcList) {
      const row = ws.addRow([pc.name, pc.label, pc.entries, Math.round(pc.min), pc.min / 60]);
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(5).numFmt = "0.0";
      row.getCell(5).alignment = { horizontal: "center" };
      for (let c = 1; c <= 5; c++) row.getCell(c).border = allBorders;
    }
    if (pcList.length > 0) {
      ws.autoFilter = { from: { row: hrB.number, column: 1 }, to: { row: hrB.number, column: 5 } };
    } else {
      const e = ws.addRow(["— sem atendimentos no período —"]);
      ws.mergeCells(e.number, 1, e.number, 5);
      ws.getCell(e.number, 1).font = { italic: true, color: { argb: "FF9CA3AF" } };
    }

    // Nota sobre auto-encerrados.
    if (auto.length > 0) {
      ws.addRow([]);
      const totalAuto = auto.reduce((s, r) => s + num(r.minutes), 0);
      const note = ws.addRow([
        `Atenção: ${Math.round(totalAuto)} min foram ENCERRADOS AUTOMATICAMENTE (abertos > 2h) — não entram nos totais acima; ver detalhe.`,
      ]);
      ws.mergeCells(note.number, 1, note.number, 5);
      const nc = ws.getCell(note.number, 1);
      nc.font = { bold: true, color: { argb: AUTO_INK } };
      nc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AUTO_BG } };
      nc.alignment = { wrapText: true, vertical: "middle" };
      note.height = 30;
    }

    void firstDataB;
    ws.views = [{ state: "frozen", ySplit: 3 }];
  }

  // ===================== Aba 2: Detalhe =====================
  {
    const ws = wb.addWorksheet("Detalhe");
    ws.getColumn(1).width = 28; // Pessoa
    ws.getColumn(2).width = 10; // Nº
    ws.getColumn(3).width = 36; // Empresa
    ws.getColumn(4).width = 13; // Dia
    ws.getColumn(5).width = 11; // Minutos
    ws.getColumn(6).width = 24; // Encerrado automaticamente
    titleBlock(ws, 6, `Exportado em ${stamp} · período: ${meta.periodLabel} · ${rows.length} linha${rows.length === 1 ? "" : "s"}`);

    const hr = headerRow(
      ws,
      ["Pessoa", "Nº", "Empresa", "Dia", "Minutos", "Encerrado automaticamente"],
      2
    );

    const sorted = [...rows].sort(
      (a, b) =>
        a.user_name.localeCompare(b.user_name, "pt-BR") ||
        companyLabel(a).localeCompare(companyLabel(b), "pt-BR") ||
        a.bucket.localeCompare(b.bucket) ||
        Number(a.auto_closed) - Number(b.auto_closed)
    );

    for (const r of sorted) {
      const serial = excelSerialFromPureDate(r.bucket);
      const row = ws.addRow([
        r.user_name,
        r.company_number ?? "",
        r.company_name,
        serial,
        Math.round(num(r.minutes)),
        r.auto_closed ? "Sim" : "Não",
      ]);
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(5).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "center" };
      if (serial != null) row.getCell(4).numFmt = "dd/mm/yyyy";
      if (r.auto_closed) {
        for (let c = 1; c <= 6; c++) {
          ws.getCell(row.number, c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: AUTO_BG },
          };
        }
        row.getCell(6).font = { bold: true, color: { argb: AUTO_INK } };
      }
      for (let c = 1; c <= 6; c++) ws.getCell(row.number, c).border = allBorders;
    }

    if (sorted.length === 0) {
      const e = ws.addRow(["— sem atendimentos no período —"]);
      ws.mergeCells(e.number, 1, e.number, 6);
      ws.getCell(e.number, 1).font = { italic: true, color: { argb: "FF9CA3AF" } };
    } else {
      ws.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: hr.number, column: 6 } };
    }
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: hr.number }];
  }

  return wb.xlsx.writeBuffer();
}

export function attendanceExportFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `calibracao-atendimento-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`;
}
