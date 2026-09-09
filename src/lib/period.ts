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
