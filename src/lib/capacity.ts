import type { createClient } from "@/lib/supabase-server";
import { brtToday } from "@/lib/period";

// Visão de capacidade da equipe (admin-only). Responde "como distribuir novos
// clientes" e "quem está sobrecarregado" — NÃO é ranking de produtividade nem
// avaliação de desempenho. Toda a agregação mora na RPC team_capacity (uma linha
// por pessoa, is_admin() checado no banco); aqui só tipamos o retorno e
// resolvemos a janela do período.
//
// REGRAS QUE A TELA MATERIALIZA (ver docs/ESPECIFICACAO e a fatia):
//  · O período afeta SÓ a ATIVIDADE. A CARTEIRA é foto do agora.
//  · Carteira NÃO soma entre pessoas (empresas se sobrepõem).
//  · Hora (time_entries, dia real BRT) é a carga; contagem de tarefa é
//    secundária, e diária × pontual são sempre separadas.
//  · A definição de "cliente ativo" (por exclusão de grupos) vive na RPC, num
//    único ponto (v_excluded) — não é reimplementada aqui.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export const CAPACITY_PERIODS = [
  "mes_atual",
  "mes_anterior",
  "30d",
  "tudo",
] as const;
export type CapacityPeriod = (typeof CAPACITY_PERIODS)[number];

export const PERIOD_LABEL: Record<CapacityPeriod, string> = {
  mes_atual: "Mês atual",
  mes_anterior: "Mês anterior",
  "30d": "Últimos 30 dias",
  tudo: "Tudo",
};

export function clampCapacityPeriod(
  raw: string | string[] | undefined
): CapacityPeriod {
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return (CAPACITY_PERIODS as readonly string[]).includes(v)
    ? (v as CapacityPeriod)
    : "30d"; // padrão
}

export type CapacityGroupSlice = { name: string; count: number };

export type CapacityRow = {
  personId: string;
  name: string | null;
  avatarPath: string | null;
  // CARTEIRA — situação atual (não muda com o período)
  carteiraActive: number;
  carteiraByGroup: CapacityGroupSlice[];
  carteiraExclusive: number;
  carteiraShared: number;
  carteiraAlerta: number;
  carteiraStalled: number; // PARADOS: > 15 dias desde o último registro (o alerta)
  carteiraNoRecord: number; // SEM REGISTRO de contato nenhum (informativo, não é abandono)
  hasCarteira: boolean; // tem carteira → entra na tabela de consultores
  isExecutor: boolean; // tem execução (qualquer tempo) → tabela de colaboradores
  // ATIVIDADE — no período selecionado
  actSeconds: number;
  actSecondsPontual: number;
  actSecondsDiaria: number;
  actPontualDone: number;
  actOverdue: number;
  actCompanies: number;
  actHasActivity: boolean;
};

// Janela do período em datas BRT (YYYY-MM-DD). `end` é EXCLUSIVO; null = sem
// limite (até agora, ou — no "tudo" — sem limite inferior). Só "mês anterior"
// precisa de limite superior.
export function periodRange(period: CapacityPeriod): {
  start: string | null;
  end: string | null;
} {
  const today = brtToday(); // 'YYYY-MM-DD' BRT
  const ym = today.slice(0, 7); // 'YYYY-MM'

  if (period === "tudo") return { start: null, end: null };

  if (period === "mes_atual") return { start: `${ym}-01`, end: null };

  if (period === "mes_anterior") {
    const [y, m] = ym.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)); // m-2: mês anterior (0-based)
    const prevStart = prev.toISOString().slice(0, 10);
    return { start: prevStart, end: `${ym}-01` };
  }

  // 30d: janela móvel de 30 dias até hoje (inclusive), sem limite superior.
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return { start: d.toISOString().slice(0, 10), end: null };
}

// Carrega a linha de cada pessoa. O escopo/segurança é do banco (is_admin()
// dentro da RPC); a página ainda barra por cargo antes de chegar aqui.
export async function loadCapacity(
  supabase: SupabaseServer,
  period: CapacityPeriod
): Promise<CapacityRow[]> {
  const { start, end } = periodRange(period);
  const { data } = await supabase.rpc("team_capacity", {
    p_start: start,
    p_end: end,
  });

  const rows =
    (data as
      | {
          person_id: string;
          person_name: string | null;
          avatar_path: string | null;
          carteira_active: number;
          carteira_by_group: CapacityGroupSlice[] | null;
          carteira_exclusive: number;
          carteira_shared: number;
          carteira_alerta: number;
          carteira_stalled: number;
          carteira_no_record: number;
          is_executor: boolean;
          act_seconds: number;
          act_seconds_pontual: number;
          act_seconds_diaria: number;
          act_pontual_done: number;
          act_overdue: number;
          act_companies: number;
          act_has_activity: boolean;
        }[]
      | null) ?? [];

  return rows.map((r) => ({
    personId: r.person_id,
    name: r.person_name,
    avatarPath: r.avatar_path,
    carteiraActive: r.carteira_active,
    carteiraByGroup: r.carteira_by_group ?? [],
    carteiraExclusive: r.carteira_exclusive,
    carteiraShared: r.carteira_shared,
    carteiraAlerta: r.carteira_alerta,
    carteiraStalled: r.carteira_stalled,
    carteiraNoRecord: r.carteira_no_record,
    hasCarteira: (r.carteira_by_group ?? []).length > 0,
    isExecutor: r.is_executor,
    actSeconds: Number(r.act_seconds),
    actSecondsPontual: Number(r.act_seconds_pontual),
    actSecondsDiaria: Number(r.act_seconds_diaria),
    actPontualDone: r.act_pontual_done,
    actOverdue: r.act_overdue,
    actCompanies: r.act_companies,
    actHasActivity: r.act_has_activity,
  }));
}

// Horas (uma casa) a partir de segundos — a carga é medida em hora, não em
// contagem de tarefa. Piso em 0 só na exibição (correções manuais podem gerar
// intervalos negativos; ver passo 32.3).
export function toHours(seconds: number): number {
  return Math.max(0, Math.round((seconds / 3600) * 10) / 10);
}
