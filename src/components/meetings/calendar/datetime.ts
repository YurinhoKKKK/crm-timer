// =====================================================================
// Datas do calendário em horário de Brasília. Offset FIXO -03:00 (Brasília sem
// horário de verão desde 2019 — mesma premissa do resto do sistema, ver
// docs/REUNIOES.md). "Civil" = data/hora de PAREDE em BRT, sem fuso. Os
// instantes vêm do banco em ISO UTC. A semana começa no DOMINGO (como o Google).
// =====================================================================

export const BRT_OFFSET_MS = 3 * 3600 * 1000;
export const MINUTES_IN_DAY = 24 * 60;

export type Civil = { y: number; m: number; d: number }; // m: 0-11

// Instante (ms UTC) da meia-noite BRT de uma data civil.
export function civilMidnightMs(c: Civil): number {
  return Date.UTC(c.y, c.m, c.d) + BRT_OFFSET_MS;
}

// Data civil BRT de um instante (ISO ou ms).
export function civilOf(iso: string | number): Civil {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const b = new Date(t - BRT_OFFSET_MS);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth(), d: b.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function civilKey(c: Civil): string {
  return `${c.y}-${pad(c.m + 1)}-${pad(c.d)}`;
}

export function addDays(c: Civil, n: number): Civil {
  const d = new Date(Date.UTC(c.y, c.m, c.d) + n * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

export function addMonths(c: Civil, n: number): Civil {
  const total = c.m + n;
  const y = c.y + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  // Preserva o dia quando possível; clampa ao último dia do mês destino.
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { y, m, d: Math.min(c.d, last) };
}

// 0=Domingo ... 6=Sábado
export function weekday(c: Civil): number {
  return new Date(Date.UTC(c.y, c.m, c.d)).getUTCDay();
}

// Domingo da semana que contém `c`.
export function weekStart(c: Civil): Civil {
  return addDays(c, -weekday(c));
}

export function sameCivil(a: Civil, b: Civil): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function todayCivil(): Civil {
  return civilOf(Date.now());
}

export function isToday(c: Civil): boolean {
  return sameCivil(c, todayCivil());
}

// Minutos desde a meia-noite BRT AGORA (posição da linha da hora atual).
export function nowMinutes(): number {
  return (Date.now() - civilMidnightMs(todayCivil())) / 60000;
}

// ISO UTC a partir de data civil + hora/min BRT (criar clicando na grade).
export function civilTimeToISO(c: Civil, hour: number, minute: number): string {
  return new Date(
    Date.UTC(c.y, c.m, c.d, hour, minute) + BRT_OFFSET_MS
  ).toISOString();
}

// Minutos de um instante desde a meia-noite BRT de `day` (pode ser <0 ou >1440
// se o evento começa/termina em outro dia; o chamador clampa à coluna).
export function minutesInDay(iso: string, day: Civil): number {
  return (new Date(iso).getTime() - civilMidnightMs(day)) / 60000;
}

// ---------------------------------------------------------------------
// Rótulos em português (BRT)
// ---------------------------------------------------------------------
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const WEEKDAYS_LONG = [
  "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
  "Quinta-feira", "Sexta-feira", "Sábado",
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// "Agosto de 2026"
export function monthLabel(c: Civil): string {
  return `${cap(MONTHS[c.m])} de ${c.y}`;
}

// "Terça-feira, 5 de agosto de 2026"
export function longDayLabel(c: Civil): string {
  return `${WEEKDAYS_LONG[weekday(c)]}, ${c.d} de ${MONTHS[c.m]} de ${c.y}`;
}

export function weekdayShort(c: Civil): string {
  return WEEKDAYS_SHORT[weekday(c)];
}

// Rótulo da semana: "3–9 de agosto de 2026" (ou com meses/anos diferentes).
export function weekRangeLabel(start: Civil): string {
  const end = addDays(start, 6);
  if (start.y !== end.y)
    return `${start.d} de ${MONTHS[start.m]} de ${start.y} – ${end.d} de ${MONTHS[end.m]} de ${end.y}`;
  if (start.m !== end.m)
    return `${start.d} de ${MONTHS[start.m]} – ${end.d} de ${MONTHS[end.m]} de ${end.y}`;
  return `${start.d}–${end.d} de ${MONTHS[start.m]} de ${start.y}`;
}

// "05:00", "14:30" (hora de parede BRT de um instante).
export function timeLabel(iso: string): string {
  const b = new Date(new Date(iso).getTime() - BRT_OFFSET_MS);
  return `${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`;
}

// Rótulo curto de uma hora inteira do gutter: "07:00".
export function hourLabel(hour: number): string {
  return `${pad(hour)}:00`;
}
