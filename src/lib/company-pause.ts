import type { createClient } from "@/lib/supabase-server";
import { pureDateDiffDays, todayBRT } from "@/lib/company-details";
import { shiftIso } from "@/lib/date-picker";

// Pausa de contrato (migration 0141) — lado do servidor + helper puro do fim
// efetivo. Só o grupo com pauses_contract=true pausa. Datas são DATA PURA
// ("YYYY-MM-DD"); nunca new Date(string) (fuso). A RLS de company_pause_periods
// (admin ou quem alcança a empresa) é a fronteira de leitura.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Dias pausados de UMA lista de períodos até `today` (ignora started_on nulo;
// corta o período aberto em hoje). Mesma conta da função SQL paused_days.
function sumPausedDays(
  periods: { started_on: string | null; ended_on: string | null }[],
  today: string
): number {
  let total = 0;
  for (const p of periods) {
    if (!p.started_on) continue;
    const endCut = p.ended_on && p.ended_on < today ? p.ended_on : today;
    const d = pureDateDiffDays(p.started_on, endCut);
    if (d > 0) total += d;
  }
  return total;
}

// Fim EFETIVO = ends_on + dias pausados. Null se não houver ends_on.
export function effectiveEndOf(
  endsOn: string | null,
  pausedDays: number
): string | null {
  if (!endsOn) return null;
  return pausedDays > 0 ? shiftIso(endsOn, pausedDays) : endsOn;
}

export type CompanyPauseInfo = {
  // Empresa está num grupo que PAUSA o contrato (pauses_contract=true).
  pausesGroup: boolean;
  openPeriodId: string | null; // período aberto (ended_on null), se houver
  pausedSince: string | null; // started_on do período aberto ("YYYY-MM-DD" | null)
  pausedDays: number; // dias pausados até hoje
  // Maior ended_on dos períodos FECHADOS — a "Pausado desde" não pode ser antes
  // disto (nem no futuro). Null se não há período fechado com data.
  prevEnd: string | null;
};

// Info de pausa de UMA empresa (página da empresa). Uma leitura do grupo + uma
// dos períodos; o cálculo é puro (mesma conta da função SQL).
export async function loadCompanyPauseInfo(
  supabase: SupabaseServer,
  companyId: string
): Promise<CompanyPauseInfo> {
  const today = todayBRT();
  const [grpRes, perRes] = await Promise.all([
    supabase
      .from("companies")
      .select("company_groups(pauses_contract)")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("company_pause_periods")
      .select("id, started_on, ended_on")
      .eq("company_id", companyId),
  ]);

  const grp = grpRes.data as
    | { company_groups: { pauses_contract: boolean } | null }
    | null;
  const pausesGroup = !!grp?.company_groups?.pauses_contract;

  const periods =
    (perRes.data as
      | { id: string; started_on: string | null; ended_on: string | null }[]
      | null) ?? [];

  const open = periods.find((p) => p.ended_on === null) ?? null;
  const closedEnds = periods
    .map((p) => p.ended_on)
    .filter((e): e is string => !!e)
    .sort();
  const prevEnd = closedEnds.length ? closedEnds[closedEnds.length - 1] : null;

  return {
    pausesGroup,
    openPeriodId: open?.id ?? null,
    pausedSince: open?.started_on ?? null,
    pausedDays: sumPausedDays(periods, today),
    prevEnd,
  };
}

// Dias pausados de VÁRIAS empresas numa consulta só (para o ContractBar das
// listas mostrarem o fim efetivo sem waterfall). Map company_id → dias. Omita
// companyIds para trazer tudo que a RLS permite. Empresas sem período = ausentes
// (0 dias).
export async function loadPausedDaysByCompany(
  supabase: SupabaseServer,
  companyIds?: string[]
): Promise<Map<string, number>> {
  const today = todayBRT();
  let query = supabase
    .from("company_pause_periods")
    .select("company_id, started_on, ended_on");
  if (companyIds) {
    const ids = Array.from(new Set(companyIds.filter(Boolean)));
    if (ids.length === 0) return new Map();
    query = query.in("company_id", ids);
  }
  const { data } = await query;
  const byCompany = new Map<
    string,
    { started_on: string | null; ended_on: string | null }[]
  >();
  for (const r of (data as
    | { company_id: string; started_on: string | null; ended_on: string | null }[]
    | null) ?? []) {
    const list = byCompany.get(r.company_id) ?? [];
    list.push({ started_on: r.started_on, ended_on: r.ended_on });
    byCompany.set(r.company_id, list);
  }
  const out = new Map<string, number>();
  byCompany.forEach((periods, cid) => {
    const d = sumPausedDays(periods, today);
    if (d > 0) out.set(cid, d);
  });
  return out;
}
