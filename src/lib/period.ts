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

export type PeriodKind = PeriodKey | "mes" | "custom";

export type ResolvedPeriod = {
  kind: PeriodKind;
  // Datas puras BRT. start null só em "tudo"; end null = aberto até hoje (atalhos).
  start: string | null;
  end: string | null;
  // Fragmento humano para encaixar nas frases ("Visão geral · {label}",
  // "Tempo trabalhado {label}", "Progresso {label}").
  label: string;
  // Rótulo curto do filtro PERSONALIZADO ativo (mês/intervalo); "" nos atalhos.
  chip: string;
  // Caiu no padrão 30d por entrada inválida (a tela mostra aviso discreto).
  invalid: boolean;
  // Ida-e-volta na URL (?periodo=... [&mes=... | &de=...&ate=...]).
  params: Record<string, string>;
};

const SHORTCUT_LABEL: Record<PeriodKey, string> = {
  hoje: "hoje",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  tudo: "em todo o período",
};

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

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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

function shortcut(p: PeriodKey, invalid = false): ResolvedPeriod {
  return {
    kind: p,
    start: periodStart(p),
    end: null,
    label: SHORTCUT_LABEL[p],
    chip: "",
    invalid,
    params: { periodo: p },
  };
}

// Resolve os parâmetros de URL num período único e validado. Entrada ausente →
// padrão 30d (sem aviso). Entrada PRESENTE mas corrompida (periodo desconhecido,
// mês fora do formato, intervalo invertido/irreal) → 30d com `invalid` (aviso).
export function resolvePeriod(input: {
  periodo?: string | string[];
  mes?: string | string[];
  de?: string | string[];
  ate?: string | string[];
}): ResolvedPeriod {
  const p = firstOf(input.periodo);

  if (p == null || p === "") return shortcut("30d");
  if (p === "hoje" || p === "7d" || p === "30d" || p === "tudo") {
    return shortcut(p);
  }

  if (p === "mes") {
    const mes = firstOf(input.mes);
    if (mes && YM_RE.test(mes)) {
      return {
        kind: "mes",
        start: `${mes}-01`,
        end: lastDayOfMonth(mes),
        label: `em ${monthYearLabel(mes)}`,
        chip: monthYearLabel(mes),
        invalid: false,
        params: { periodo: "mes", mes },
      };
    }
    return shortcut("30d", true);
  }

  if (p === "custom") {
    const de = firstOf(input.de);
    const ate = firstOf(input.ate);
    if (de && ate && isRealDate(de) && isRealDate(ate) && de <= ate) {
      return {
        kind: "custom",
        start: de,
        end: ate,
        label: `de ${brDate(de)} a ${brDate(ate)}`,
        chip: `${brDate(de)} – ${brDate(ate)}`,
        invalid: false,
        params: { periodo: "custom", de, ate },
      };
    }
    return shortcut("30d", true);
  }

  // periodo presente mas desconhecido → padrão com aviso.
  return shortcut("30d", true);
}

// Query string dos parâmetros do período (para links que preservam o filtro:
// drill-down de tarefas e "voltar"). Não inclui o "?".
export function periodQuery(resolved: ResolvedPeriod): string {
  return new URLSearchParams(resolved.params).toString();
}

// =====================================================================
// PERÍODO DO DASHBOARD (/admin e /admin/colaboradores/[id]) — seletor próprio
// com atalhos + calendário. Modelo SEPARADO do ResolvedPeriod da central da
// empresa (contratos de URL diferentes): aqui os atalhos de INTERVALO (7d, 30d,
// este mês, mês passado) materializam em ?de/?ate; só Ontem/Hoje/Tudo usam
// ?periodo. start/end são DATAS puras BRT (YYYY-MM-DD); end é INCLUSIVO; ambos
// null só em "Tudo" (sem filtro — idêntico ao comportamento anterior).
//
// Datas: texto AAAA-MM-DD de ponta a ponta. A aritmética de calendário é pura
// (sobre inteiros ou sobre a data UTC-âncora de `addDays`, já usada no arquivo);
// nada de fuso em data pura. "Hoje" vem de brtToday().
// =====================================================================

export type DashboardPreset = "ontem" | "hoje" | "tudo" | "custom";

export type DashboardPeriod = {
  preset: DashboardPreset;
  // Datas puras BRT. Ambas null só em "tudo".
  start: string | null;
  end: string | null;
  // Rótulo textual SEMPRE visível: "02/10/2026" (um dia), "01/09/2026 a
  // 30/09/2026" (intervalo) ou "Tudo".
  label: string;
  // Ida-e-volta na URL (?periodo=ontem|hoje|tudo OU ?de=...&ate=...).
  params: Record<string, string>;
};

// Soma `days` (pode ser negativo) a uma data 'YYYY-MM-DD'. Mesma âncora UTC do
// `minusDays` acima (contamos dias de calendário, imune a horário de verão).
export function addDays(ymd: string, days: number): string {
  return minusDays(ymd, -days);
}

// Hoje/Ontem em BRT.
export function brtYesterday(): string {
  return addDays(brtToday(), -1);
}

function dayLabel(start: string, end: string): string {
  return start === end ? brDate(start) : `${brDate(start)} a ${brDate(end)}`;
}

function customPeriod(start: string, end: string): DashboardPeriod {
  // Inverte se vier fim antes do início (decisão: 1º clique início, 2º fim).
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return {
    preset: "custom",
    start: lo,
    end: hi,
    label: dayLabel(lo, hi),
    params: { de: lo, ate: hi },
  };
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

// Resolve os parâmetros de URL do dashboard num período validado. Padrão (nada
// ou inválido) = HOJE, sem erro. de/ate têm precedência (atalhos de intervalo e
// personalizado materializam neles). Links antigos ?periodo=7d|30d continuam
// funcionando, convertidos em intervalo.
export function resolveDashboardPeriod(input: {
  periodo?: string | string[];
  de?: string | string[];
  ate?: string | string[];
}): DashboardPeriod {
  const today = brtToday();
  const hoje = (): DashboardPeriod => ({
    preset: "hoje",
    start: today,
    end: today,
    label: brDate(today),
    params: { periodo: "hoje" },
  });

  const de = firstOf(input.de);
  const ate = firstOf(input.ate);
  if (de != null || ate != null) {
    if (de && ate && isRealDate(de) && isRealDate(ate)) {
      return customPeriod(de, ate);
    }
    return hoje(); // intervalo corrompido cai em Hoje
  }

  const p = firstOf(input.periodo);
  if (p == null || p === "") return hoje();
  if (p === "hoje") return hoje();
  if (p === "ontem") {
    const y = brtYesterday();
    return {
      preset: "ontem",
      start: y,
      end: y,
      label: brDate(y),
      params: { periodo: "ontem" },
    };
  }
  if (p === "tudo") {
    return { preset: "tudo", start: null, end: null, label: "Tudo", params: { periodo: "tudo" } };
  }
  // Retrocompatibilidade: ?periodo=7d|30d viram intervalo materializado.
  if (p === "7d") {
    const r = last7Range();
    return customPeriod(r.start, r.end);
  }
  if (p === "30d") {
    const r = last30Range();
    return customPeriod(r.start, r.end);
  }
  // Desconhecido → Hoje (sem erro).
  return hoje();
}

// Query string dos parâmetros do período do dashboard (links/"voltar"), sem "?".
export function dashboardQuery(p: DashboardPeriod): string {
  return new URLSearchParams(p.params).toString();
}

// Fragmento humano para a frase "Visão geral · {...}".
export function dashboardPhrase(p: DashboardPeriod): string {
  if (p.preset === "tudo") return "em todo o período";
  if (p.preset === "ontem") return "ontem";
  if (p.preset === "hoje") return "hoje";
  return p.start === p.end
    ? `em ${brDate(p.start as string)}`
    : `de ${brDate(p.start as string)} a ${brDate(p.end as string)}`;
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
