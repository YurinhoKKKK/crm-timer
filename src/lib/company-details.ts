import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";
import { SALES_CHANNELS, type SalesChannel } from "@/lib/revenue";

// Informações do cliente (tela própria dentro da página da empresa) — lado do
// servidor + helpers puros compartilhados com o componente de cliente.
//
// Leitura escopada pela RLS (cd_select / ccc_select): admin, consultor da
// carteira e colaborador com tarefa na empresa. Escrita só admin. O portal do
// cliente NUNCA vê nada disto.
//
// DATAS são tratadas como DATA PURA ("YYYY-MM-DD"). NUNCA passamos essas strings
// por `new Date(string)` no cliente — o fuso deslocaria o dia (mesmo motivo já
// documentado no faturamento). A aritmética de datas usa Date.UTC (sem fuso).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// --- Enums (rótulos legíveis) ------------------------------------------------

export const PROJECT_MODELS = [
  { value: "bpo", label: "BPO" },
  { value: "consultoria", label: "Consultoria" },
] as const;

export type ProjectModel = (typeof PROJECT_MODELS)[number]["value"];

export const CADENCES = [
  { value: "semanal", label: "Semanal" },
  { value: "quinzenal", label: "Quinzenal" },
  { value: "semanal_quinzenal", label: "Semanal, depois quinzenal" },
  { value: "quinzenal_semanal", label: "Quinzenal, depois semanal" },
] as const;

export type Cadence = (typeof CADENCES)[number]["value"];

export const PROJECT_MODEL_LABEL: Record<ProjectModel, string> =
  Object.fromEntries(PROJECT_MODELS.map((m) => [m.value, m.label])) as Record<
    ProjectModel,
    string
  >;

export const CADENCE_LABEL: Record<Cadence, string> = Object.fromEntries(
  CADENCES.map((c) => [c.value, c.label])
) as Record<Cadence, string>;

// --- Tipo carregado ----------------------------------------------------------

export type CompanyDetails = {
  projectModel: ProjectModel | null;
  startedOn: string | null; // "YYYY-MM-DD" (data pura)
  endsOn: string | null;
  cadence: Cadence | null;
  systemUsed: string | null;
  mainPain: string | null;
  about: string | null;
  updatedAtISO: string | null;
  updatedByName: string | null;
  // Marketplaces CONTRATADOS (o que foi vendido), na ordem do enum.
  contractedChannels: SalesChannel[];
  // Canais já ATIVOS no faturamento (company_sales_channels.active). Vem VAZIO
  // para o colaborador (a RLS de faturamento não o inclui) — a tela então omite
  // o cruzamento contratado×ativo para ele, coerente com "colaborador não vê
  // faturamento". null = "não sei" (colaborador); [] só ocorre p/ admin/consultor.
  activeChannels: SalesChannel[] | null;
};

const CHANNEL_ORDER: SalesChannel[] = SALES_CHANNELS.map((c) => c.value);

function sortChannels(channels: SalesChannel[]): SalesChannel[] {
  return CHANNEL_ORDER.filter((c) => channels.includes(c));
}

// Carrega tudo da tela em três leituras paralelas, cada uma escopada pela RLS.
// `canSeeRevenue` decide se sequer tentamos ler os canais ativos do faturamento
// (o colaborador não passa na RLS de company_sales_channels; nem tentamos).
export async function loadCompanyDetails(
  supabase: SupabaseServer,
  companyId: string,
  canSeeRevenue: boolean
): Promise<CompanyDetails> {
  const [detailRes, contractedRes, activeRes] = await Promise.all([
    supabase
      .from("company_details")
      .select(
        "project_model, started_on, ends_on, cadence, system_used, main_pain, about, updated_at, updated_by"
      )
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("company_contracted_channels")
      .select("channel")
      .eq("company_id", companyId),
    canSeeRevenue
      ? supabase
          .from("company_sales_channels")
          .select("channel")
          .eq("company_id", companyId)
          .eq("active", true)
      : Promise.resolve({ data: null as { channel: SalesChannel }[] | null }),
  ]);

  const d = detailRes.data as
    | {
        project_model: ProjectModel | null;
        started_on: string | null;
        ends_on: string | null;
        cadence: Cadence | null;
        system_used: string | null;
        main_pain: string | null;
        about: string | null;
        updated_at: string | null;
        updated_by: string | null;
      }
    | null;

  const contracted = sortChannels(
    ((contractedRes.data as { channel: SalesChannel }[] | null) ?? []).map(
      (r) => r.channel
    )
  );
  const active = canSeeRevenue
    ? sortChannels(
        ((activeRes.data as { channel: SalesChannel }[] | null) ?? []).map(
          (r) => r.channel
        )
      )
    : null;

  let updatedByName: string | null = null;
  if (d?.updated_by) {
    const people = await resolvePeople(supabase, [d.updated_by]);
    updatedByName = people.get(d.updated_by)?.name ?? null;
  }

  return {
    projectModel: d?.project_model ?? null,
    startedOn: d?.started_on ?? null,
    endsOn: d?.ends_on ?? null,
    cadence: d?.cadence ?? null,
    systemUsed: d?.system_used ?? null,
    mainPain: d?.main_pain ?? null,
    about: d?.about ?? null,
    updatedAtISO: d?.updated_at ?? null,
    updatedByName,
    contractedChannels: contracted,
    activeChannels: active,
  };
}

// ---------------------------------------------------------------------
// Helpers puros de DATA (compartilhados com o componente de cliente)
// ---------------------------------------------------------------------

// "YYYY-MM-DD" de HOJE no fuso de Brasília (dia CIVIL, sem hora). en-CA já
// devolve nesse formato — evita montar a string à mão.
export function todayBRT(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

// Diferença em dias inteiros entre duas datas puras (b - a). Usa Date.UTC para
// NÃO sofrer fuso — nunca `new Date("YYYY-MM-DD")`, que interpreta como UTC e
// deslocaria em horário local.
export function pureDateDiffDays(a: string, b: string): number {
  const ua = utcOf(a);
  const ub = utcOf(b);
  return Math.round((ub - ua) / 86_400_000);
}

function utcOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// "2026-09-02" → "02/09/2026". Deriva das partes da string, sem Date.
export function formatPureDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Informação do período do contrato, CALCULADA (nunca guardada). Contrato
// encerrado nunca vira dias negativos.
export type PeriodInfo =
  | { state: "empty" }
  | { state: "start_only"; startedOn: string }
  | {
      state: "end_only";
      endsOn: string;
      ended: boolean;
      remaining: number; // dias até o fim (0 = encerra hoje). Ignorar se ended.
    }
  | {
      state: "full";
      startedOn: string;
      endsOn: string;
      totalDays: number; // dias do período (inclusivo)
      ended: boolean;
      remaining: number;
    };

// Barra visual do período do contrato (espírito da coluna Timeline do Monday).
// SÓ existe quando as DUAS datas estão preenchidas — sem elas, não se desenha
// barra (o chamador não renderiza nada). Percent é o tempo DECORRIDO, sempre
// entre 0 e 100. `nearEnd` (≤ 30 dias restantes) é o sinal mais acionável:
// renovação à vista.
export type ContractBar =
  | { state: "not_started"; startsInDays: number }
  | { state: "in_progress"; percent: number; remaining: number; nearEnd: boolean }
  | { state: "ended"; endedDaysAgo: number };

export function computeContractBar(
  startedOn: string | null,
  endsOn: string | null,
  today: string
): ContractBar | null {
  if (!startedOn || !endsOn) return null;

  const toStart = pureDateDiffDays(today, startedOn); // > 0 = começa no futuro
  if (toStart > 0) return { state: "not_started", startsInDays: toStart };

  const toEnd = pureDateDiffDays(today, endsOn); // >= 0 restante · < 0 encerrado
  if (toEnd < 0) return { state: "ended", endedDaysAgo: -toEnd };

  // Em andamento (hoje entre início e fim, inclusive). Guarda contra started ==
  // ends (total 0): nesse caso está encerrando hoje (100%).
  const total = pureDateDiffDays(startedOn, endsOn);
  const elapsed = pureDateDiffDays(startedOn, today);
  const percent =
    total <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  return { state: "in_progress", percent, remaining: toEnd, nearEnd: toEnd <= 30 };
}

export function computePeriodInfo(
  startedOn: string | null,
  endsOn: string | null,
  today: string
): PeriodInfo {
  if (!startedOn && !endsOn) return { state: "empty" };
  if (startedOn && !endsOn) return { state: "start_only", startedOn };

  if (!startedOn && endsOn) {
    const remaining = pureDateDiffDays(today, endsOn);
    return { state: "end_only", endsOn, ended: remaining < 0, remaining };
  }

  // Ambos presentes.
  const s = startedOn as string;
  const e = endsOn as string;
  const remaining = pureDateDiffDays(today, e);
  const totalDays = pureDateDiffDays(s, e) + 1; // inclusivo
  return {
    state: "full",
    startedOn: s,
    endsOn: e,
    totalDays,
    ended: remaining < 0,
    remaining,
  };
}
