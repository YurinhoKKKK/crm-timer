"use server";

import { createClient } from "@/lib/supabase-server";
import {
  periodRange,
  type CapacityPeriod,
} from "@/lib/capacity";

// Drill-down da tela de Capacidade: a LISTA por trás de um número. Sai do BANCO
// (RPC team_capacity_drilldown), que repete o MESMO critério de ativo e de
// vermelho do cálculo (fonte única em capacity_excluded_groups / client_followup)
// — se divergisse, a tela mostraria 25 e listaria 24. É só leitura; o is_admin()
// é checado dentro da RPC. Nada é filtrado no cliente a partir de base grande.

export type DrilldownScope =
  | "ativos"
  | "exclusivos"
  | "compartilhados"
  | "alerta"
  | "parados"
  | "sem_registro"
  | "empresas";

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
