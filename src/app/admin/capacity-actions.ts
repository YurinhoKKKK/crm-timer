"use server";

import { createClient } from "@/lib/supabase-server";
import {
  periodRange,
  type CapacityPeriod,
  type DrilldownScope,
  type TaskDrilldownScope,
} from "@/lib/capacity";

// Os tipos/const/guard de recorte moram em "@/lib/capacity" (módulo neutro):
// este arquivo é "use server" e só pode exportar funções async.

// Drill-down da tela de Capacidade: a LISTA por trás de um número. Sai do BANCO
// (RPC team_capacity_drilldown), que repete o MESMO critério de ativo e de
// vermelho do cálculo (fonte única em capacity_excluded_groups / client_followup)
// — se divergisse, a tela mostraria 25 e listaria 24. É só leitura; o is_admin()
// é checado dentro da RPC. Nada é filtrado no cliente a partir de base grande.

export type DrilldownLabel = {
  name: string;
  bgColor: string;
  textColor: string;
  highlight: boolean;
};

export type DrilldownConsultant = {
  id: string;
  name: string | null;
  avatarPath: string | null;
};

export type DrilldownCompany = {
  id: string;
  name: string;
  group: string;
  labels: DrilldownLabel[];
  sharedWith: DrilldownConsultant[]; // só preenchido em "compartilhados"
  daysSince: number | null; // relevante em "parados"/"sem_registro"; null = nunca contatado
};

export async function getCapacityDrilldown(
  personId: string,
  scope: DrilldownScope,
  period: CapacityPeriod
): Promise<{ error: string | null; companies?: DrilldownCompany[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  // Período só faz diferença em "empresas" (atendidas no período); nos recortes
  // de carteira a RPC ignora o intervalo (foto do agora).
  const { start, end } = periodRange(period);

  const { data, error } = await supabase.rpc("team_capacity_drilldown", {
    p_person: personId,
    p_scope: scope,
    p_start: start,
    p_end: end,
  });
  if (error) return { error: error.message };

  const rows =
    (data as
      | {
          company_id: string;
          company_name: string;
          group_name: string;
          labels:
            | { name: string; bg_color: string; text_color: string; highlight: boolean }[]
            | null;
          shared_with:
            | { id: string; name: string | null; avatar_path: string | null }[]
            | null;
          days_since: number | null;
        }[]
      | null) ?? [];

  const companies: DrilldownCompany[] = rows.map((r) => ({
    id: r.company_id,
    name: r.company_name,
    group: r.group_name,
    labels: (r.labels ?? []).map((l) => ({
      name: l.name,
      bgColor: l.bg_color,
      textColor: l.text_color,
      highlight: l.highlight,
    })),
    sharedWith: (r.shared_with ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      avatarPath: c.avatar_path,
    })),
    daysSince: r.days_since,
  }));

  return { error: null, companies };
}

// -------------------------------------------------------------- TAREFAS
// As colunas de atividade (Horas, Pontuais, Atrasadas) contam tarefa/tempo, não
// empresa — a lista por trás é de TAREFAS. Sai da RPC team_capacity_task_drilldown,
// que repete os MESMOS filtros de team_capacity (o conjunto de linhas casa
// exatamente com o número da célula). Cada tarefa é clicável no painel (abre o
// TaskDetailSheet). Só leitura; is_admin() é checado dentro da RPC.

export type DrilldownTask = {
  id: string;
  title: string;
  companyName: string;
  status: string;
  refAt: string | null; // pontuais: conclusão; atrasadas: prazo; horas: último apontamento
  seconds: number | null; // só em "horas" (tempo somado no período para a tarefa)
};

export async function getCapacityTaskDrilldown(
  personId: string,
  scope: TaskDrilldownScope,
  period: CapacityPeriod
): Promise<{ error: string | null; tasks?: DrilldownTask[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { start, end } = periodRange(period);
  const { data, error } = await supabase.rpc("team_capacity_task_drilldown", {
    p_person: personId,
    p_scope: scope,
    p_start: start,
    p_end: end,
  });
  if (error) return { error: error.message };

  const rows =
    (data as
      | {
          task_id: string;
          title: string;
          company_name: string;
          status: string;
          ref_at: string | null;
          seconds: number | string | null;
        }[]
      | null) ?? [];

  const tasks: DrilldownTask[] = rows.map((r) => ({
    id: r.task_id,
    title: r.title,
    companyName: r.company_name,
    status: r.status,
    refAt: r.ref_at,
    seconds: r.seconds === null ? null : Number(r.seconds),
  }));

  return { error: null, tasks };
}
