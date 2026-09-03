import { todayBRT, formatPureDate } from "@/lib/company-details";

// Helpers PUROS do seletor de data do projeto. Regra inegociável: tudo fala
// TEXTO "AAAA-MM-DD" (data pura). NUNCA `new Date("AAAA-MM-DD")` (interpreta como
// UTC e desloca no fuso local — foi bug real neste projeto). Onde precisamos de
// aritmética de calendário usamos Date.UTC + getters UTC: construímos e lemos no
// MESMO fuso (UTC), então o resultado é determinístico e sem deslocamento.

export { todayBRT, formatPureDate };

export const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Cabeçalho da grade (domingo a sábado). Iniciais com title para leitor de tela.
export const WEEKDAYS_PT = [
  { short: "D", full: "Domingo" },
  { short: "S", full: "Segunda" },
  { short: "T", full: "Terça" },
  { short: "Q", full: "Quarta" },
  { short: "Q", full: "Quinta" },
  { short: "S", full: "Sexta" },
  { short: "S", full: "Sábado" },
];

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "AAAA-MM-DD" válido? (forma + dia existente no mês)
export function isValidIso(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

// Digitação BR "DD/MM/AAAA" → "AAAA-MM-DD" (ou null se inválida). Aceita 1–2
// dígitos em dia/mês; exige 4 no ano.
export function parseBRToIso(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

// Dígitos → máscara BR progressiva "DD/MM/AAAA" (para o campo formatar enquanto
// digita, sem impor barras a mais do que os dígitos permitem).
export function maskBR(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  let out = dd;
  if (digits.length >= 3) out += "/" + mm;
  else if (raw.endsWith("/") && dd.length === 2) out += "/";
  if (digits.length >= 5) out += "/" + yyyy;
  else if (raw.endsWith("/") && mm.length === 2 && digits.length >= 4) out += "/";
  return out;
}

export function daysInMonth(year: number, month1to12: number): number {
  // Dia 0 do mês seguinte = último dia deste mês. Tudo em UTC.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// Dia da semana (0=domingo..6=sábado) do dia 1 do mês, em UTC.
export function firstWeekdayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12 - 1, 1)).getUTCDay();
}

// Soma `days` a uma data pura, devolvendo data pura. Construção e leitura em UTC.
export function shiftIso(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
    dt.getUTCDate()
  )}`;
}

export function ymOfIso(iso: string): { year: number; month: number } {
  const [y, mo] = iso.split("-").map(Number);
  return { year: y, month: mo };
}

// Move a VISÃO por N meses, devolvendo {year, month(1-12)}. Sem Date de string.
export function addMonthsYm(
  year: number,
  month1to12: number,
  delta: number
): { year: number; month: number } {
  const zeroBased = month1to12 - 1 + delta;
  const y = year + Math.floor(zeroBased / 12);
  const m = ((zeroBased % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

// Constrói a matriz do mês: 6 semanas × 7 dias. Cada célula é uma iso "AAAA-MM-DD"
// (inclusive as de preenchimento das semanas de borda, dos meses vizinhos), com
// um flag `inMonth` para estilizar. Assim a navegação por teclado atravessa os
// limites do mês naturalmente.
export type CalendarCell = { iso: string; day: number; inMonth: boolean };

export function monthMatrix(year: number, month1to12: number): CalendarCell[][] {
  const firstWd = firstWeekdayOfMonth(year, month1to12);
  // A grade começa no domingo da semana que contém o dia 1.
  const startIso = shiftIso(`${year}-${pad2(month1to12)}-01`, -firstWd);
  const weeks: CalendarCell[][] = [];
  let cursor = startIso;
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const { year: cy, month: cm } = ymOfIso(cursor);
      const day = Number(cursor.split("-")[2]);
      row.push({ iso: cursor, day, inMonth: cy === year && cm === month1to12 });
      cursor = shiftIso(cursor, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

// Anos para o seletor rápido: uma janela ampla ao redor do ano em foco (contrato
// pode ser de vários anos). Inclui o ano corrente e o ano atualmente exibido.
export function yearOptions(focusYear: number): number[] {
  const base = ymOfIso(todayBRT()).year;
  const lo = Math.min(base, focusYear) - 8;
  const hi = Math.max(base, focusYear) + 8;
  const out: number[] = [];
  for (let y = lo; y <= hi; y++) out.push(y);
  return out;
}
