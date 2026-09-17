import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";

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

// Serviços CONTRATADOS (o que foi vendido) — enum PRÓPRIO (contracted_service),
// desacoplado do sales_channel do faturamento (migration 0083). Marketplaces
// primeiro (mesma ordem histórica), depois os serviços que não são canais de
// receita. NÃO tem 'site_proprio' — foi substituído por gestão/desenvolvimento
// de site NESTE campo (o faturamento mantém 'site_proprio' à parte).
export const CONTRACTED_SERVICES = [
  { value: "mercado_livre", label: "Mercado Livre" },
  { value: "shopee", label: "Shopee" },
  { value: "amazon", label: "Amazon" },
  { value: "trafego", label: "Tráfego" },
  { value: "gestao_site", label: "Gestão de site" },
  { value: "desenvolvimento_site", label: "Desenvolvimento de site" },
] as const;

export type ContractedService = (typeof CONTRACTED_SERVICES)[number]["value"];

export const CONTRACTED_SERVICE_LABEL: Record<ContractedService, string> =
  Object.fromEntries(
    CONTRACTED_SERVICES.map((s) => [s.value, s.label])
  ) as Record<ContractedService, string>;

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
  // Serviços CONTRATADOS (o que foi vendido), na ordem do enum.
  contractedServices: ContractedService[];
};

const SERVICE_ORDER: ContractedService[] = CONTRACTED_SERVICES.map(
  (s) => s.value
);

function sortServices(services: ContractedService[]): ContractedService[] {
  return SERVICE_ORDER.filter((s) => services.includes(s));
}

// Carrega tudo da tela em duas leituras paralelas, cada uma escopada pela RLS.
export async function loadCompanyDetails(
  supabase: SupabaseServer,
  companyId: string
): Promise<CompanyDetails> {
  const [detailRes, contractedRes] = await Promise.all([
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

  const contracted = sortServices(
    ((contractedRes.data as { channel: ContractedService }[] | null) ?? []).map(
      (r) => r.channel
    )
  );

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
    contractedServices: contracted,
  };
}

// started_on de VÁRIAS empresas numa consulta só — para a etiqueta DERIVADA
// "Cliente Novo" nas listas (ver [[new-client]]). Map company_id → "YYYY-MM-DD"
// (ou null). Escopo pela RLS cd_select (admin, consultor da carteira, colaborador
// que alcança) — o mesmo recorte das telas. NUNCA uma consulta por empresa.
// Omita `companyIds` para trazer tudo que a RLS permite (uma query, sem waterfall).
export async function loadStartedOnByCompany(
  supabase: SupabaseServer,
  companyIds?: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  let query = supabase
    .from("company_details")
    .select("company_id, started_on");
  if (companyIds) {
    const ids = Array.from(new Set(companyIds.filter(Boolean)));
    if (ids.length === 0) return map;
    query = query.in("company_id", ids);
  }
  const { data } = await query;
  for (const row of (data as
    | { company_id: string; started_on: string | null }[]
    | null) ?? []) {
    map.set(row.company_id, row.started_on);
  }
  return map;
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
