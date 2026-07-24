// Limites de período no fuso de Brasília (America/Sao_Paulo).
//
// Antes, cada tela calculava o início do período com `new Date().toISOString()`,
// que devolve a data em UTC. No servidor da Vercel (UTC), das 21:00 à meia-noite
// BRT isso já apontava para o DIA SEGUINTE — o filtro "Hoje" ficava errado à
// noite. Aqui a data de referência é sempre BRT.
//
// task_date é uma data BRT; no banco os time_entries são filtrados por
// started_at BRT. Estes helpers devolvem a DATA BRT (YYYY-MM-DD) do início do
// período, usada nos dois casos.

const BRT = "America/Sao_Paulo";

export type PeriodKey = "hoje" | "7d" | "30d" | "tudo";

// Data de hoje em BRT, como 'YYYY-MM-DD' (en-CA formata nesse padrão).
export function brtToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BRT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Subtrai `days` de uma data 'YYYY-MM-DD' (aritmética de calendário pura, em UTC
// para não sofrer com horário de verão — só contamos dias de calendário).
function minusDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Início do período (data BRT, YYYY-MM-DD) para filtrar por task_date (listas /
// contagens) e por started_at (tempo, no banco). null = todo o período.
export function periodStart(period: PeriodKey): string | null {
  if (period === "tudo") return null;
  const today = brtToday();
  if (period === "hoje") return today;
  if (period === "7d") return minusDays(today, 6);
  return minusDays(today, 29); // 30d
}

// Primeiro dia do mês atual (BRT), YYYY-MM-DD.
export function monthStart(): string {
  return `${brtToday().slice(0, 7)}-01`;
}
