import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";

// Faturamento mensal por canal de venda (Fatia 1) — lado do servidor + helpers
// puros compartilhados com o cliente.
//
// FATURAMENTO BRUTO (antes de taxas e comissões). Dado comercial sensível:
// alcançam admin, consultor da empresa e (desde 0071) colaborador nas empresas
// em que atua — tudo escopado pela RLS. O cliente NUNCA vê.
//
// reference_month é tratado como DATA PURA no formato "YYYY-MM-DD" (dia 1). NUNCA
// passamos essa string por `new Date(...)` no cliente — o fuso deslocaria o mês
// para o anterior. Rótulos e ano/mês saem de manipulação de string.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export const SALES_CHANNELS = [
  { value: "mercado_livre", label: "Mercado Livre" },
  { value: "shopee", label: "Shopee" },
  { value: "amazon", label: "Amazon" },
  { value: "site_proprio", label: "Site próprio" },
] as const;

export type SalesChannel = (typeof SALES_CHANNELS)[number]["value"];

export const CHANNEL_LABEL: Record<SalesChannel, string> = Object.fromEntries(
  SALES_CHANNELS.map((c) => [c.value, c.label])
) as Record<SalesChannel, string>;

export type RevenueMonth = {
  // "YYYY-MM-DD" (sempre dia 1). Data pura — não é um instante.
  month: string;
  // Valor por canal LANÇADO no mês (canal ausente = "sem registro" naquele
  // canal; presente com 0 = zero digitado). Já somado no banco.
  channels: Partial<Record<SalesChannel, number>>;
  total: number;
  // Distingue "mês sem registro nenhum" de "mês com 0 lançado".
  hasRecord: boolean;
  note: string | null;
};

export type RevenueOverview = {
  currentMonth: string;
  // Faixa efetivamente exibida ("YYYY-MM-DD", dia 1). Com filtro = o intervalo
  // pedido; sem filtro (Tudo) = do primeiro lançamento ao mês mais recente.
  rangeStart: string;
  rangeEnd: string;
  filtered: boolean;
  channelConfig: Partial<Record<SalesChannel, boolean>>;
  activeChannels: SalesChannel[];
  channelTotals: Partial<Record<SalesChannel, number>>;
  grandTotal: number;
  months: RevenueMonth[];
};

// Intervalo do filtro por período. null/null = "Tudo".
export type RevenueRange = { start: string | null; end: string | null };

// Valida os parâmetros de URL do filtro (fatDe / fatAte, formato "YYYY-MM").
// Intervalo invertido, mês inexistente ou parâmetro corrompido NÃO quebram a
// tela: caem no padrão Tudo com `invalid` marcado (a tela mostra um aviso
// discreto). Comparação lexicográfica de "YYYY-MM" já respeita a ordem.
export function parseRevenueRange(
  de?: string,
  ate?: string
): { range: RevenueRange; invalid: boolean } {
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!de && !ate) return { range: { start: null, end: null }, invalid: false };
  if (!de || !ate || !re.test(de) || !re.test(ate)) {
    return { range: { start: null, end: null }, invalid: true };
  }
  if (de > ate) return { range: { start: null, end: null }, invalid: true };
  return { range: { start: `${de}-01`, end: `${ate}-01` }, invalid: false };
}

// --- Fatia 2: insights (variação, acumulado, progressão) -------------------

// Tipo de variação de um mês (ou canal num mês) contra o mês anterior:
//   ok             — variação numérica (percent presente)
//   no_base        — mês anterior sem registro ("sem base de comparação")
//   first_positive — mês anterior com valor zero ("primeiro mês com faturamento")
//   current        — mês corrente, parcial ("mês em andamento")
export type VariationKind = "ok" | "no_base" | "first_positive" | "current";
export type Variation = { kind: VariationKind; percent?: number };

export type RevenueInsights = {
  currentMonth: string;
  rangeStart: string;
  rangeEnd: string;
  filtered: boolean;
  summary: {
    lastClosed: { month: string; total: number } | null;
    variation: Variation | null;
    accumulated: { total: number; monthsWithRecord: number };
  };
  // Variação do TOTAL por mês (chave "YYYY-MM-DD").
  totalVariations: Record<string, Variation>;
  // Variação por canal por mês (chave mês → { canal → Variation }).
  channelVariations: Record<string, Partial<Record<SalesChannel, Variation>>>;
};

// Toda variação e o acumulado saem do banco em numeric (RPC
// company_revenue_insights, SECURITY INVOKER — mesmo escopo da Fatia 1). O
// cliente só formata.
export async function loadCompanyRevenueInsights(
  supabase: SupabaseServer,
  companyId: string,
  range?: RevenueRange
): Promise<RevenueInsights> {
  const { data } = await supabase.rpc("company_revenue_insights", {
    p_company: companyId,
    p_start: range?.start ?? null,
    p_end: range?.end ?? null,
  });
  const raw = (data ?? {}) as Partial<RevenueInsights>;
  return {
    currentMonth: raw.currentMonth ?? "",
    rangeStart: raw.rangeStart ?? "",
    rangeEnd: raw.rangeEnd ?? "",
    filtered: raw.filtered ?? false,
    summary: raw.summary ?? {
      lastClosed: null,
      variation: null,
      accumulated: { total: 0, monthsWithRecord: 0 },
    },
    totalVariations: raw.totalVariations ?? {},
    channelVariations: raw.channelVariations ?? {},
  };
}

// --- Autoria + histórico de alterações de um mês ---------------------------

// Uma linha do histórico de alterações (append-only, alimentado por trigger no
// banco). `changedByName` null = "autor não registrado" (lançamento antigo/
// gravação direta no banco, sem usuário). oldAmount null = primeiro lançamento;
// newAmount null = valor removido.
export type RevenueAuditEntry = {
  id: string;
  channel: SalesChannel;
  oldAmount: number | null;
  newAmount: number | null;
  reason: string | null;
  changedByName: string | null;
  changedAtISO: string;
};

// Detalhe de autoria de um mês: quem lançou (linha criada mais cedo) e quem
// alterou por último (linha atualizada mais recentemente; null se nunca
// editada), mais o histórico completo. Nomes já resolvidos no servidor.
export type RevenueMonthDetail = {
  createdByName: string | null;
  createdAtISO: string | null;
  updatedByName: string | null;
  updatedAtISO: string | null;
  audit: RevenueAuditEntry[];
};

// Carrega autoria + histórico de UM mês (RPC company_revenue_month_detail,
// SECURITY INVOKER — mesmo escopo do faturamento). Resolve os nomes de autor
// pela display_profiles (a RLS de profiles não deixa ler perfis alheios direto).
export async function loadCompanyRevenueMonthDetail(
  supabase: SupabaseServer,
  companyId: string,
  monthIso: string
): Promise<RevenueMonthDetail> {
  const { data } = await supabase.rpc("company_revenue_month_detail", {
    p_company: companyId,
    p_month: monthIso,
  });

  type RawAudit = {
    id: string;
    channel: SalesChannel;
    oldAmount: number | string | null;
    newAmount: number | string | null;
    reason: string | null;
    changedBy: string | null;
    changedAt: string;
  };
  type Raw = {
    createdBy: string | null;
    createdAt: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
    audit: RawAudit[];
  };
  const raw = (data ?? {}) as Partial<Raw>;
  const auditRaw = raw.audit ?? [];

  const people = await resolvePeople(supabase, [
    raw.createdBy,
    raw.updatedBy,
    ...auditRaw.map((a) => a.changedBy),
  ]);
  const nameOf = (id: string | null | undefined) =>
    id ? people.get(id)?.name ?? null : null;
  const num = (v: number | string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);

  return {
    createdByName: nameOf(raw.createdBy),
    createdAtISO: raw.createdAt ?? null,
    updatedByName: nameOf(raw.updatedBy),
    updatedAtISO: raw.updatedAt ?? null,
    audit: auditRaw.map((a) => ({
      id: a.id,
      channel: a.channel,
      oldAmount: num(a.oldAmount),
      newAmount: num(a.newAmount),
      reason: a.reason ?? null,
      changedByName: nameOf(a.changedBy),
      changedAtISO: a.changedAt,
    })),
  };
}

// Cores das LINHAS do gráfico = a MESMA identidade dos marketplaces do
// MarketplaceBadge (MARKETPLACE_COLORS), agora VIVAS e em variante por tema onde
// a cor de marca não serve aos dois fundos — não é uma segunda paleta, é a
// mesma linguagem adaptada ao traço. Regras que resolvem os três conflitos:
//   • Mercado Livre = seu amarelo #FFE600 (a cor viva da marca). O amarelo brilha
//     no escuro mas some no branco → no claro vira o gold #B8860B da mesma
//     família (contraste ≥ 3:1 sobre a superfície do card).
//   • Shopee e Amazon são ambos laranja e colidiriam lado a lado. Mantendo a
//     família de cada um, a Shopee foi empurrada p/ o vermelho-vivo (o lado
//     avermelhado do #EE4D2D) e a Amazon fica no seu âmbar #FF9900 — assim se
//     separam. (Alterei a Shopee.) No claro a Amazon escurece p/ ganhar
//     contraste sobre o branco.
//   • site_proprio NÃO é marketplace → azul da marca (risd), neutro às marcas.
// O Total é neutro e mora à parte (totalColor no gráfico): é a leitura
// principal, não compete com as cores de canal.
export type ThemeColor = { light: string; dark: string };

export const CHANNEL_LINE_COLOR: Record<SalesChannel, ThemeColor> = {
  mercado_livre: { light: "#B8860B", dark: "#FFE600" },
  shopee: { light: "#E23A16", dark: "#FF5436" },
  amazon: { light: "#C56E00", dark: "#FF9900" },
  site_proprio: { light: "#2536E0", dark: "#5B6BFF" },
};

// Percentual em pt-BR, uma casa decimal, SEMPRE com sinal (menos o zero, que é
// neutro): +12,4% · -4,2% · 0,0%.
export function formatPercentBR(percent: number): string {
  const abs = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(percent));
  const sign = percent > 0 ? "+" : percent < 0 ? "-" : "";
  return `${sign}${abs}%`;
}

// Ponto da série do gráfico. Mês sem registro é BURACO (null em tudo), não ponto
// em zero — ligar a linha por cima desenharia uma queda que não aconteceu. O mês
// CORRENTE também fica null nas séries principais: ele é parcial e não deve ligar
// ao mês anterior (a queda seria falsa) — é desenhado à parte, como ponto solto.
export type RevenueSeriesPoint = {
  monthIso: string;
  label: string;
  isCurrent: boolean;
  total: number | null;
} & Partial<Record<SalesChannel, number | null>>;

// Constrói a série cronológica (mais antigo → mais recente) a partir dos meses
// que a Fatia 1 já agregou no banco. Só PLOTA valores prontos — nenhuma
// aritmética de dinheiro aqui. O mês corrente entra na série (para existir a
// categoria no eixo X) mas com valores NULL nas séries principais; seu valor é
// desenhado como ponto solto (ReferenceDot) pelo gráfico.
export function buildRevenueSeries(
  months: RevenueMonth[],
  currentMonth: string
): RevenueSeriesPoint[] {
  return months
    .slice()
    .reverse() // months vem do mais recente; o eixo X é cronológico
    .map((m) => {
      const isCurrent = m.month === currentMonth;
      const drawable = m.hasRecord && !isCurrent;
      const point: RevenueSeriesPoint = {
        monthIso: m.month,
        label: monthLabel(m.month),
        isCurrent,
        total: drawable ? m.total : null,
      };
      for (const ch of SALES_CHANNELS) {
        const v = m.channels[ch.value];
        point[ch.value] = drawable && v !== undefined ? v : null;
      }
      return point;
    });
}

// Canais a DESENHAR: todo canal com pelo menos um lançamento no intervalo
// exibido (ativo ou não). Canal sem nenhum lançamento não vira linha nem
// legenda. Mesma lógica que protege a tabela do histórico de canal desativado.
export function channelsWithHistory(months: RevenueMonth[]): SalesChannel[] {
  return SALES_CHANNELS.map((c) => c.value).filter((ch) =>
    months.some((m) => m.hasRecord && m.channels[ch] !== undefined)
  );
}

// O valor do mês corrente (parcial), desenhado como ponto solto. null se o mês
// corrente não estiver no intervalo ou não tiver registro.
export function currentMonthValues(
  months: RevenueMonth[],
  currentMonth: string
): { total: number; channels: Partial<Record<SalesChannel, number>> } | null {
  const cur = months.find((m) => m.month === currentMonth && m.hasRecord);
  if (!cur) return null;
  return { total: cur.total, channels: cur.channels };
}

// Rótulo do intervalo para os cartões/rodapé (ex.: "fev/2026 a jul/2026").
export function rangeLabel(startIso: string, endIso: string): string {
  return `${monthLabel(startIso)} a ${monthLabel(endIso)}`;
}

// Agregação NO BANCO (RPC company_revenue_overview, SECURITY INVOKER). Nunca
// somamos array no cliente: PostgREST trunca em 1000 sem aviso e soma de
// dinheiro em ponto flutuante acumula centavo. O RPC devolve tudo pré-somado
// como numeric; aqui só damos forma ao objeto.
export async function loadCompanyRevenue(
  supabase: SupabaseServer,
  companyId: string,
  range?: RevenueRange
): Promise<RevenueOverview> {
  const { data } = await supabase.rpc("company_revenue_overview", {
    p_company: companyId,
    p_start: range?.start ?? null,
    p_end: range?.end ?? null,
  });

  const raw = (data ?? {}) as Partial<RevenueOverview>;
  return {
    currentMonth: raw.currentMonth ?? "",
    rangeStart: raw.rangeStart ?? "",
    rangeEnd: raw.rangeEnd ?? "",
    filtered: raw.filtered ?? false,
    channelConfig: raw.channelConfig ?? {},
    activeChannels: raw.activeChannels ?? [],
    channelTotals: raw.channelTotals ?? {},
    grandTotal: raw.grandTotal ?? 0,
    months: raw.months ?? [],
  };
}

// ---------------------------------------------------------------------
// Helpers puros (compartilhados com os componentes de cliente)
// ---------------------------------------------------------------------

const MONTH_ABBR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// "2026-07-01" → "jul/2026". SEMPRE com ano (a série passa de doze meses e
// "jul" sozinho fica ambíguo). Deriva da string, sem Date (sem risco de fuso).
export function monthLabel(iso: string): string {
  const [year, month] = iso.split("-");
  const idx = Number(month) - 1;
  const abbr = MONTH_ABBR[idx] ?? month;
  return `${abbr}/${year}`;
}

export function yearOf(iso: string): number {
  return Number(iso.split("-")[0]);
}

export function monthNumberOf(iso: string): number {
  return Number(iso.split("-")[1]);
}

// Monta "YYYY-MM-01" a partir de ano/mês NUMÉRICOS (nunca por Date).
export function isoMonth(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}-01`;
}

// Exibição SEMPRE formatada em Real (pt-BR). Os valores já vêm somados do banco;
// aqui só formatamos para leitura — nenhuma aritmética de dinheiro no cliente.
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number): string {
  return BRL.format(value);
}

// Parse do valor em PADRÃO BRASILEIRO ("118.400,50" = ponto de milhar, vírgula
// decimal). NÃO usamos parseFloat direto (devolveria 118.4 e gravaria errado
// silenciosamente): tratamos o formato explicitamente e devolvemos uma STRING
// decimal canônica ("118400.50") para o banco converter em numeric — sem passar
// por float em momento algum.
//
// Distinção crítica: string vazia → { value: null } ("sem registro", não grava
// linha). "0"/"0,00" → { value: "0" } (zero digitado, grava 0,00).
export function parseCurrencyBR(raw: string): {
  value: string | null;
  error?: string;
} {
  const s = raw.trim();
  if (s === "") return { value: null };

  // Mantém dígitos, ponto, vírgula e o SINAL (descarta "R$", espaços, etc.). O
  // sinal é mantido de propósito: se estiver presente, a validação final abaixo
  // rejeita — faturamento é sempre >= 0, e queremos ERRAR em vez de converter
  // "-50" em "50" silenciosamente (o tipo de transformação muda que a Fatia
  // proíbe).
  const cleaned = s.replace(/[^\d.,-]/g, "");
  if (cleaned === "") return { value: null, error: "Valor inválido." };

  // pt-BR: pontos são separador de milhar (removidos), a vírgula é o decimal.
  // Uma única vírgula é permitida; mais de uma é entrada malformada.
  if ((cleaned.match(/,/g) ?? []).length > 1) {
    return { value: null, error: "Valor inválido." };
  }
  const canonical = cleaned.replace(/\./g, "").replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(canonical)) {
    return { value: null, error: "Valor inválido." };
  }
  return { value: canonical };
}

// Formata um valor numérico já conhecido de volta ao input pt-BR ("118400.5" →
// "118.400,50"), para pré-preencher o formulário de edição.
export function toInputBR(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value);
}
