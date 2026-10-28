import type { createClient } from "@/lib/supabase-server";
import type { PeriodConfig } from "@/lib/period";

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

// Config do PeriodPicker da seção "Atendimento por WhatsApp" (params namespaced
// wde/wate, independentes do período das tarefas). Vive aqui (módulo neutro) para
// a página (server) poder importar sem cair no gotcha "const de 'use client' vira
// {}". Fim INCLUSIVO: as RPCs de atendimento tratam p_end como inclusivo.
export const ATTENDANCE_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: [],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado"],
  default: "30d",
  params: { periodo: "wperiodo", de: "wde", ate: "wate", mes: "wmes" },
};

// Config do PeriodPicker da seção "Consultores" (params namespaced cde/cate,
// independentes do período das tarefas e do de atendimento). Controla SÓ a coluna
// "Horas em reunião" (o resto da tabela — carteira/alerta/parados — é foto do
// agora). Mesmos atalhos e padrão (30 dias) da Capacidade de tarefas. Vive aqui
// (módulo neutro) para a página (server) poder importar.
export const CAPACITY_CONSULTANTS_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: [],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado"],
  default: "30d",
  params: { periodo: "cperiodo", de: "cde", ate: "cate", mes: "cmes" },
};

export type CapacityGroupSlice = { name: string; count: number };

// ------------------------------------------------------- RECORTES DO DRILL-DOWN
// Vivem aqui (módulo neutro) e não no arquivo de server actions: um arquivo
// "use server" só pode exportar funções async — nada de const/type/guard.
//
// Recortes que abrem uma lista de EMPRESAS (o painel padrão).
export type DrilldownScope =
  | "ativos"
  | "exclusivos"
  | "compartilhados"
  | "alerta"
  | "parados"
  | "empresas"
  | "fora_da_carteira"
  | "colab_ativos";

// Recorte que abre a lista de REUNIÕES cronometradas da pessoa no período
// (decisão 10 — substitui o antigo "sem registro"). Dado próprio (horas de
// reunião), via capacity_person_meetings; não é empresa nem tarefa.
export type MeetingsDrilldownScope = "reunioes";

// Recortes que abrem uma lista de TAREFAS (colunas de atividade — contam
// tarefa/tempo, não empresa; a lista de tarefas casa exata com a célula).
export const TASK_DRILLDOWN_SCOPES = ["horas", "pontuais", "atrasadas"] as const;
export type TaskDrilldownScope = (typeof TASK_DRILLDOWN_SCOPES)[number];

// União usada pelos handlers de clique da tela (empresa OU tarefa OU reuniões).
export type AnyDrilldownScope =
  | DrilldownScope
  | TaskDrilldownScope
  | MeetingsDrilldownScope;

export function isTaskScope(s: AnyDrilldownScope): s is TaskDrilldownScope {
  return (TASK_DRILLDOWN_SCOPES as readonly string[]).includes(s);
}

export function isMeetingsScope(s: AnyDrilldownScope): s is MeetingsDrilldownScope {
  return s === "reunioes";
}

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
  carteiraStalled: number; // PARADOS: vermelhos no último dia útil fechado (Digisac)
  meetingSeconds: number; // HORAS EM REUNIÃO no período (decisão 10) — segundos somados
  hasCarteira: boolean; // tem carteira → entra na tabela de consultores
  isExecutor: boolean; // tem execução (qualquer tempo) → tabela de colaboradores
  // CARTEIRA DO COLABORADOR (vínculo declarado — company_collaborators, 0090).
  // A tabela de colaboradores passa a mostrar clientes ativos + composição.
  colabCarteiraActive: number;
  colabCarteiraByGroup: CapacityGroupSlice[];
  hasColabCarteira: boolean; // tem vínculo declarado → aparece na tabela mesmo sem execução
  // FORA DA CARTEIRA (foto do agora): empresas com tarefa EM ABERTO onde a pessoa
  // NÃO é responsável — a exceção indevida que a mudança de âncora quer expor.
  colabOutOfPortfolio: number;
  // ATIVIDADE — no período selecionado
  actSeconds: number;
  actSecondsPontual: number;
  actSecondsDiaria: number;
  actPontualDone: number;
  actOverdue: number;
  actCompanies: number;
  actHasActivity: boolean;
};

// Janela do período (datas BRT YYYY-MM-DD). `end` é EXCLUSIVO aqui (a RPC
// team_capacity compara < p_end); null = sem limite. O PeriodPicker entrega `end`
// INCLUSIVO — a página converte (end + 1 dia) antes de passar para cá.
export type CapacityWindow = { start: string | null; end: string | null };

// Carrega a linha de cada pessoa. O escopo/segurança é do banco (is_admin()
// dentro da RPC); a página ainda barra por cargo antes de chegar aqui.
export async function loadCapacity(
  supabase: SupabaseServer,
  window: CapacityWindow
): Promise<CapacityRow[]> {
  const { start, end } = window;
  const { data, error } = await supabase.rpc("team_capacity", {
    p_start: start,
    p_end: end,
  });

  // Não engolir a falha em silêncio: uma RPC que erra (ex.: PGRST202 logo após
  // um drop+recreate, com o cache de schema do PostgREST ainda velho) apareceria
  // como "nenhum dado" sem pista nenhuma. Logamos no servidor para o diagnóstico.
  if (error) {
    console.error("[capacidade] team_capacity falhou:", error);
  }

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
          meeting_seconds: number | string;
          is_executor: boolean;
          act_seconds: number;
          act_seconds_pontual: number;
          act_seconds_diaria: number;
          act_pontual_done: number;
          act_overdue: number;
          act_companies: number;
          act_has_activity: boolean;
          colab_active: number;
          colab_by_group: CapacityGroupSlice[] | null;
          has_colab_carteira: boolean;
          colab_out_of_portfolio: number;
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
    meetingSeconds: Number(r.meeting_seconds),
    hasCarteira: (r.carteira_by_group ?? []).length > 0,
    isExecutor: r.is_executor,
    actSeconds: Number(r.act_seconds),
    actSecondsPontual: Number(r.act_seconds_pontual),
    actSecondsDiaria: Number(r.act_seconds_diaria),
    actPontualDone: r.act_pontual_done,
    actOverdue: r.act_overdue,
    actCompanies: r.act_companies,
    actHasActivity: r.act_has_activity,
    colabCarteiraActive: r.colab_active,
    colabCarteiraByGroup: r.colab_by_group ?? [],
    hasColabCarteira: r.has_colab_carteira,
    colabOutOfPortfolio: r.colab_out_of_portfolio,
  }));
}

// Horas em reunião por pessoa no período da seção Consultores (params cde/cate).
// RPC leve (capacity_consultant_meetings) que reusa a MESMA regra de soma de
// reunião do team_capacity (migration 0161), para a coluna "Horas em reunião"
// seguir o filtro próprio dos Consultores sem chamar team_capacity de novo.
// `window.end` é EXCLUSIVO (a página converte o `end` inclusivo somando 1 dia).
export async function loadConsultantMeetings(
  supabase: SupabaseServer,
  window: CapacityWindow
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("capacity_consultant_meetings", {
    p_start: window.start,
    p_end: window.end,
  });
  const map = new Map<string, number>();
  if (error) {
    console.error("[capacidade] capacity_consultant_meetings falhou:", error);
    return map;
  }
  for (const r of (data as
    | { consultant_id: string; meeting_seconds: number | string }[]
    | null) ?? []) {
    map.set(r.consultant_id, Number(r.meeting_seconds));
  }
  return map;
}

// Horas (uma casa) a partir de segundos — a carga é medida em hora, não em
// contagem de tarefa. Piso em 0 só na exibição (correções manuais podem gerar
// intervalos negativos; ver passo 32.3).
export function toHours(seconds: number): number {
  return Math.max(0, Math.round((seconds / 3600) * 10) / 10);
}
