// Fonte de verdade ÚNICA do tempo exibido (passo 28.1). O timer da tela da
// tarefa e o indicador global (pill) usam estes helpers, para não divergirem
// de novo.
//
// REGRA CENTRAL: o tempo NUNCA é acumulado por ticks. A cada tick ele é
// DERIVADO do banco — total_seconds + (agora − started_at do intervalo aberto).
// Assim, remontar o componente, trocar de rota ou perder ticks (throttle de aba
// em segundo plano) não afeta o número: ele se autocorrige a cada segundo.
// O setInterval serve apenas para disparar o re-render.

/** Interpreta o started_at do banco (timestamptz) em ms UTC. */
export function parseStartedAt(iso: string | null | undefined): number | null {
  if (!iso) return null;
  // O PostgREST devolve com offset ("...+00:00"), mas se vier sem nenhuma marca
  // de fuso o Date.parse assumiria hora LOCAL — o que deslocaria o tempo em 3h
  // no fuso de Brasília. Marcamos como UTC nesse caso.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const ms = Date.parse(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Tempo TOTAL da tarefa em segundos: o já registrado no banco mais o intervalo
 * aberto, se houver. É o mesmo número na tela da tarefa e no pill.
 */
export function taskElapsedSeconds(
  totalSeconds: number,
  startedAtMs: number | null,
  nowMs: number
): number {
  const open = startedAtMs === null ? 0 : Math.max(0, (nowMs - startedAtMs) / 1000);
  return Math.max(0, totalSeconds) + open;
}

/** hh:mm:ss — mostrador grande da tela da tarefa. */
export function formatClock(totalSeconds: number): string {
  const { h, m, s } = split(totalSeconds);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** m:ss até 1h, depois h:mm:ss — formato compacto do pill. */
export function formatElapsedCompact(totalSeconds: number): string {
  const { h, m, s } = split(totalSeconds);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Duração legível para TOTAIS (horas de reunião da empresa, coluna da Capacidade,
 * trechos): "15 min", "1 h 05 min". Granularidade de minuto (arredonda). A
 * ordenação nas tabelas continua pelo número de segundos, nunca por este texto.
 */
export function formatDurationBR(totalSeconds: number): string {
  const mins = Math.max(0, Math.round(totalSeconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m} min` : `${h} h ${pad(m)} min`;
}

// ---------------------------------------------------------------------------
// Timer de REUNIÃO — fonte ÚNICA do tempo exibido (pop-up, cards e linha da
// empresa). A base NÃO tiquetaqueia (manual_seconds, se houver, OU a soma dos
// trechos FECHADOS). O que corre é cada trecho aberto: (agora + skew − início).
// `skewMs` corrige o relógio do navegador contra o do servidor (decisão 4): o
// "agora" do cálculo é SEMPRE Date.now() a cada tique, nunca um acumulador +1 s.
// ---------------------------------------------------------------------------
export type MeetingTimerBase = {
  baseSeconds: number; // parte que não corre (manual OU soma dos trechos fechados)
  openStartsMs: number[]; // início (ms UTC) de cada trecho aberto; vazio = parado
  skewMs: number; // defasagem servidor − navegador no momento do fetch
};

export function meetingLiveSeconds(base: MeetingTimerBase, nowMs: number): number {
  let total = Math.max(0, base.baseSeconds);
  for (const start of base.openStartsMs) {
    total += Math.max(0, (nowMs + base.skewMs - start) / 1000);
  }
  return total;
}

/** Defasagem (ms) servidor − navegador, calculada uma vez a partir do server_now. */
export function clockSkewMs(serverNowIso: string | null | undefined): number {
  const s = parseStartedAt(serverNowIso);
  return s === null ? 0 : s - Date.now();
}

function split(totalSeconds: number) {
  const t = Math.max(0, Math.floor(totalSeconds));
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
