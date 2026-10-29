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

// =====================================================================
// Período RESOLVIDO — atalhos + mês/ano + intervalo livre numa fonte só.
// =====================================================================
// A central da empresa passou a aceitar, além dos atalhos, um MÊS específico e
// um INTERVALO livre. Todos viram um par [start, end] de DATA PURA em BRT, mais
// um rótulo humano que ACOMPANHA o filtro (os cartões e o título usam-no) e os
// parâmetros de URL para persistir a escolha (?periodo=...). A validação mora
// aqui (servidor): entrada corrompida cai no padrão 30d com `invalid` marcado —
// nunca quebra a tela.
//
// FRONTEIRAS: start/end são datas puras (YYYY-MM-DD), nunca timestamp no
// cliente. O banco converte para meia-noite BRT ao filtrar time_entries; as
// contagens comparam task_date (já BRT) direto. `end` é INCLUSIVO (o último dia
// conta). Atalhos não têm limite superior (end=null): seguem abertos até hoje,
// preservando exatamente os números de antes.

const MONTHS_FULL_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// "2026-03" → "março/2026". Deriva da string, sem Date (sem risco de fuso).
export function monthYearLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS_FULL_PT[Number(m) - 1] ?? m}/${y}`;
}

// "2026-03-05" → "05/03/2026". Só recorta a string.
export function brDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

// Último dia do mês (YYYY-MM → YYYY-MM-DD). Date.UTC(y, m, 0): mês 1-12 vira o
// índice do mês SEGUINTE, dia 0 = último dia do mês pedido. Aritmética UTC pura,
// sem fuso local.
export function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Data real "YYYY-MM-DD": formato certo E dia existente (rejeita 2026-02-30,
// que ao passar por Date "vira" 02 de março). Round-trip em UTC, sem fuso.
function isRealDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// =====================================================================
// Helpers de data compartilhados pelo modelo único de período (abaixo) e pelo
// PeriodPicker: aritmética pura sobre datas BRT (YYYY-MM-DD), sem fuso.
// =====================================================================

// Soma `days` (pode ser negativo) a uma data 'YYYY-MM-DD'. Mesma âncora UTC do
// `minusDays` acima (contamos dias de calendário, imune a horário de verão).
export function addDays(ymd: string, days: number): string {
  return minusDays(ymd, -days);
}

// Hoje/Ontem em BRT.
export function brtYesterday(): string {
  return addDays(brtToday(), -1);
}

// Atalhos que viram intervalo materializado (?de/?ate).
export function last7Range(): { start: string; end: string } {
  const today = brtToday();
  return { start: addDays(today, -6), end: today };
}
export function last30Range(): { start: string; end: string } {
  const today = brtToday();
  return { start: addDays(today, -29), end: today };
}
export function thisMonthRange(): { start: string; end: string } {
  const ym = brtToday().slice(0, 7);
  return { start: `${ym}-01`, end: lastDayOfMonth(ym) };
}
export function lastMonthRange(): { start: string; end: string } {
  const ym = shiftMonth(brtToday().slice(0, 7), -1);
  return { start: `${ym}-01`, end: lastDayOfMonth(ym) };
}

// "outubro/2026" → "Outubro/2026" (rótulo autônomo do filtro, não em frase).
function capitalizeFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// --- Aritmética de calendário PURA (sobre inteiros) para o PeriodPicker ------

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// Nº de dias do mês de um "YYYY-MM".
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  if (m === 2 && isLeap(y)) return 29;
  return DAYS_IN_MONTH[m - 1];
}

// Dia da semana do dia 01 do mês (0=domingo … 6=sábado) — algoritmo de Sakamoto,
// inteiros puros, sem Date.
export function firstWeekdayOfMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + 1) % 7;
}

// Desloca um "YYYY-MM" por `delta` meses (com virada de ano). Inteiros puros.
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

// Monta uma data pura a partir de (ano, mês 1-12, dia). Sem Date.
export function makeYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "YYYY-MM-DD" → "YYYY-MM".
export function ymOf(ymd: string): string {
  return ymd.slice(0, 7);
}

// Rótulo curto do mês ("março", sem o ano) para o cabeçalho do calendário.
export function monthName(ym: string): string {
  const m = Number(ym.split("-")[1]);
  return MONTHS_FULL_PT[m - 1] ?? ym;
}

// =====================================================================
// MODELO ÚNICO DE PERÍODO — alimenta o PeriodPicker compartilhado
// (src/components/PeriodPicker.tsx). Na LEITURA, substitui os modelos
// específicos de cada tela (DashboardPeriod, ResolvedPeriod, ChurnPeriod, …) por
// uma só forma {kind,start,end,label,params} + um resolvedor configurável por
// props. Links antigos continuam funcionando (convertidos aqui).
//
// FRONTEIRAS: start/end são DATAS puras BRT (YYYY-MM-DD); `end` é INCLUSIVO;
// ambos null em "tudo"; `end` null nunca ocorre aqui (atalhos materializam o
// último dia). A conversão para o que cada servidor espera (ex.: Capacidade usa
// `end` EXCLUSIVO) mora no loader da tela — aqui o contrato é sempre inclusivo.
// =====================================================================

export type ShortcutId =
  | "ontem"
  | "hoje"
  | "tudo"
  | "7d"
  | "30d"
  | "este_mes"
  | "mes_passado"
  | "calib_start";

export type PeriodValue = {
  kind: ShortcutId | "custom" | "mes";
  // Datas puras BRT (YYYY-MM-DD), end INCLUSIVO. Ambas null só em "tudo".
  start: string | null;
  end: string | null;
  // Rótulo SEMPRE visível ao lado do seletor ("Período: {label}"): estilo
  // Dashboard — "02/10/2026", "01/09/2026 a 30/09/2026", "Outubro/2026", "Tudo".
  label: string;
  // Ida-e-volta na URL (com os nomes de param da tela — ver PeriodParamNames).
  params: Record<string, string>;
  // Link trouxe período corrompido → caímos no padrão (a tela mostra um aviso).
  invalid?: boolean;
};

// Nomes dos parâmetros de URL. Padrão = periodo/de/ate/mes; telas que coexistem
// com outro seletor na MESMA URL usam prefixo (ex.: fatDe/fatAte, hde/hate).
export type PeriodParamNames = {
  periodo: string;
  de: string;
  ate: string;
  mes: string;
};

export type PeriodMode = "range" | "month";

export type PeriodConfig = {
  // Atalhos visíveis na barra e dentro do popover ("Período").
  barShortcuts: ShortcutId[];
  popoverShortcuts: ShortcutId[];
  // Valor aplicado quando a URL vem vazia.
  default: ShortcutId;
  // Permite escolher dias/meses após hoje (padrão: não).
  allowFuture?: boolean;
  // "range" (calendário de dias) ou "month" (grade de meses).
  mode?: PeriodMode;
  // Modo mês com intervalo de MESES por 2 cliques (Faturamento).
  monthRange?: boolean;
  // Modo mês: trava meses anteriores a este (ex.: início da série).
  minMonth?: string;
  // Data de início do atalho "Desde o início" (Calibração).
  calibStart?: string;
  // Sobrepõe os nomes dos parâmetros de URL (namespacing por tela).
  params?: Partial<PeriodParamNames>;
};

const DEFAULT_PERIOD_PARAMS: PeriodParamNames = {
  periodo: "periodo",
  de: "de",
  ate: "ate",
  mes: "mes",
};

// Configs compartilhados das telas com parâmetros PADRÃO (periodo/de/ate). Ficam
// aqui para a tela E o seu drill-down (que herda o período pela URL) resolverem
// com o MESMO contrato. As telas com params namespaced (Faturamento, Histórico,
// Capacidade/atendimento) ou com início de calibração montam o config localmente.
export const DASHBOARD_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: ["ontem", "hoje", "tudo"],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado"],
  default: "hoje",
  // Dashboard e detalhe do colaborador aceitam datas futuras: uma tarefa com
  // prazo à frente pode já ter sido trabalhada (ex.: Listagem com prazo amanhã
  // feita hoje), e o filtro precisa alcançá-la.
  allowFuture: true,
};

export const CENTRAL_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: ["ontem", "hoje", "tudo"],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado"],
  default: "30d",
};

export const CHURN_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: ["tudo"],
  popoverShortcuts: ["este_mes", "mes_passado"],
  default: "este_mes",
};

export const CAPACITY_TASKS_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: [],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado"],
  default: "30d",
};

// Nomes efetivos dos parâmetros desta tela (padrão + sobreposições).
export function periodParamNames(config: PeriodConfig): PeriodParamNames {
  return { ...DEFAULT_PERIOD_PARAMS, ...config.params };
}

const YM_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Intervalo "Desde o início" (Calibração): do início informado até hoje.
export function calibStartRange(start: string): { start: string; end: string } {
  return { start, end: brtToday() };
}

// Monta um valor de INTERVALO de dias (kind "custom" ou atalho materializado).
function rangeValue(
  kind: PeriodValue["kind"],
  start: string,
  end: string,
  names: PeriodParamNames,
  invalid = false
): PeriodValue {
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return {
    kind,
    start: lo,
    end: hi,
    label: lo === hi ? brDate(lo) : `${brDate(lo)} a ${brDate(hi)}`,
    params: { [names.de]: lo, [names.ate]: hi },
    invalid,
  };
}

// Mês único (Acompanhamento/Pontuação) → ?mes=YYYY-MM.
function monthSingleValue(mes: string, names: PeriodParamNames): PeriodValue {
  return {
    kind: "mes",
    start: `${mes}-01`,
    end: lastDayOfMonth(mes),
    label: capitalizeFirst(monthYearLabel(mes)),
    params: { [names.mes]: mes },
  };
}

// Materializa um atalho num PeriodValue. Ontem/Hoje/Tudo usam ?periodo; os
// atalhos de intervalo (7d/30d/este mês/mês passado/desde o início) viram ?de/ate
// — exatamente como o Dashboard (no reload aparecem como "custom").
function shortcutValue(
  s: ShortcutId,
  config: PeriodConfig,
  names: PeriodParamNames,
  invalid = false
): PeriodValue {
  const today = brtToday();
  if (s === "tudo") {
    return { kind: "tudo", start: null, end: null, label: "Tudo", params: { [names.periodo]: "tudo" }, invalid };
  }
  if (s === "hoje") {
    return { kind: "hoje", start: today, end: today, label: brDate(today), params: { [names.periodo]: "hoje" }, invalid };
  }
  if (s === "ontem") {
    const y = brtYesterday();
    return { kind: "ontem", start: y, end: y, label: brDate(y), params: { [names.periodo]: "ontem" }, invalid };
  }
  let r: { start: string; end: string };
  if (s === "7d") r = last7Range();
  else if (s === "30d") r = last30Range();
  else if (s === "este_mes") r = thisMonthRange();
  else if (s === "mes_passado") r = lastMonthRange();
  else r = calibStartRange(config.calibStart ?? today); // calib_start
  return finishCalib(rangeValue("custom", r.start, r.end, names, invalid), config);
}

// Rótulo especial "Desde o início da calibração" quando o intervalo bate certo
// com o início informado até hoje (preserva o texto da tela antiga).
function finishCalib(v: PeriodValue, config: PeriodConfig): PeriodValue {
  if (config.calibStart && v.start === config.calibStart && v.end === brtToday()) {
    return { ...v, label: "Desde o início da calibração" };
  }
  return v;
}

// Resolve os parâmetros de URL (lidos pelos nomes do config) num PeriodValue
// validado. Entrada ausente → `config.default`; entrada presente mas corrompida
// → default com `invalid`. Aceita, por retrocompatibilidade, os parâmetros
// antigos de cada tela (7d/30d, mes_atual/mes_anterior/todos, periodo=mes/custom).
export function resolvePeriodValue(
  input: Record<string, string | string[] | undefined>,
  config: PeriodConfig
): PeriodValue {
  const names = periodParamNames(config);
  if ((config.mode ?? "range") === "month") {
    return resolveMonthValue(input, config, names);
  }

  const de = firstOf(input[names.de]);
  const ate = firstOf(input[names.ate]);
  if (de != null || ate != null) {
    if (de && ate && isRealDate(de) && isRealDate(ate)) {
      return finishCalib(rangeValue("custom", de, ate, names), config);
    }
    return shortcutValue(config.default, config, names, true);
  }

  const p = firstOf(input[names.periodo]);
  if (p == null || p === "") return shortcutValue(config.default, config, names);

  const SHORTCUTS: ShortcutId[] = [
    "ontem", "hoje", "tudo", "7d", "30d", "este_mes", "mes_passado", "calib_start",
  ];
  if ((SHORTCUTS as string[]).includes(p)) {
    return shortcutValue(p as ShortcutId, config, names);
  }
  // Retrocompatibilidade de links antigos (Churn / Capacidade).
  if (p === "mes_atual") return shortcutValue("este_mes", config, names);
  if (p === "mes_anterior") return shortcutValue("mes_passado", config, names);
  if (p === "todos") return shortcutValue("tudo", config, names);
  // Central legada: ?periodo=mes&mes=YYYY-MM.
  if (p === "mes") {
    const mes = firstOf(input[names.mes]);
    if (mes && YM_MONTH_RE.test(mes)) return monthSingleValue(mes, names);
    return shortcutValue(config.default, config, names, true);
  }
  return shortcutValue(config.default, config, names, true);
}

function resolveMonthValue(
  input: Record<string, string | string[] | undefined>,
  config: PeriodConfig,
  names: PeriodParamNames
): PeriodValue {
  const curMonth = brtToday().slice(0, 7);

  if (config.monthRange) {
    // Faturamento: intervalo de MESES em de/ate (YYYY-MM); "tudo" = sem filtro.
    const p = firstOf(input[names.periodo]);
    if (p === "tudo" || p === "todos") {
      return { kind: "tudo", start: null, end: null, label: "Tudo", params: { [names.periodo]: "tudo" } };
    }
    const de = firstOf(input[names.de]);
    const ate = firstOf(input[names.ate]);
    if (de != null || ate != null) {
      const dm = (de ?? "").slice(0, 7);
      const am = (ate ?? "").slice(0, 7);
      if (YM_MONTH_RE.test(dm) && YM_MONTH_RE.test(am)) {
        const [lo, hi] = dm <= am ? [dm, am] : [am, dm];
        return {
          kind: "custom",
          start: `${lo}-01`,
          end: `${hi}-01`, // marcador do mês final (o loader soma o mês inteiro)
          label:
            lo === hi
              ? capitalizeFirst(monthYearLabel(lo))
              : `${capitalizeFirst(monthYearLabel(lo))} a ${capitalizeFirst(monthYearLabel(hi))}`,
          params: { [names.de]: lo, [names.ate]: hi },
        };
      }
      return { kind: "tudo", start: null, end: null, label: "Tudo", params: {}, invalid: true };
    }
    return { kind: "tudo", start: null, end: null, label: "Tudo", params: {} };
  }

  // Mês único (Acompanhamento/Pontuação) → ?mes=YYYY-MM, sem futuro.
  const mes = firstOf(input[names.mes]);
  let ym = mes && YM_MONTH_RE.test(mes) ? mes : curMonth;
  if (ym > curMonth) ym = curMonth;
  if (config.minMonth && ym < config.minMonth) ym = config.minMonth;
  return monthSingleValue(ym, names);
}

// PeriodValue de um atalho (para o componente: navegar com `.params` e detectar
// qual atalho está ativo comparando start/end).
export function shortcutPeriodValue(s: ShortcutId, config: PeriodConfig): PeriodValue {
  return shortcutValue(s, config, periodParamNames(config));
}

// Query string dos parâmetros do período (back-links que preservam o filtro).
export function periodValueQuery(v: PeriodValue): string {
  return new URLSearchParams(v.params).toString();
}

// Fragmento humano para encaixar em frases ("Visão geral · {…}", "Tempo
// trabalhado {…}", "Progresso {…}").
export function periodPhrase(v: PeriodValue): string {
  if (v.kind === "tudo" || (!v.start && !v.end)) return "em todo o período";
  if (v.kind === "ontem") return "ontem";
  if (v.kind === "hoje") return "hoje";
  if (v.kind === "mes" && v.start) return `em ${monthYearLabel(v.start.slice(0, 7))}`;
  if (v.start && v.end) {
    return v.start === v.end
      ? `em ${brDate(v.start)}`
      : `de ${brDate(v.start)} a ${brDate(v.end)}`;
  }
  return "em todo o período";
}
