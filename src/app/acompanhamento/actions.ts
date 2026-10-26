"use server";

import { createClient } from "@/lib/supabase-server";
import {
  monthToDate,
  type DayColor,
  type ScoreDetailRow,
  type CompanyHistory,
  type ClientEventDay,
} from "@/lib/followup";

// Drill-down da aba Pontuação: a grade dia×empresa por trás do total de um
// colaborador. Sai do BANCO (RPC followup_scores_detail, SECURITY DEFINER), que
// checa is_admin() por dentro e repete o MESMO critério do resumo mensal — se
// divergisse, o total não bateria com a soma da grade. collaboratorId null =
// empresas sem responsável. Só leitura; nada é filtrado no cliente a partir de
// base grande.
export async function getScoresDetail(
  collaboratorId: string | null,
  month: string
): Promise<{ error: string | null; rows?: ScoreDetailRow[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase.rpc("followup_scores_detail", {
    p_collaborator: collaboratorId,
    p_month: monthToDate(month),
  });
  if (error) return { error: error.message };

  const rows: ScoreDetailRow[] = (
    (data as
      | {
          company_id: string;
          company_name: string;
          d: string;
          contact_color: DayColor;
          color: DayColor;
          recovery_need: number;
          evento: string | null;
          first_msg_at: string | null;
          points: number;
        }[]
      | null) ?? []
  ).map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    day: r.d,
    color: r.color,
    contactColor: r.contact_color,
    recoveryNeed: Number(r.recovery_need),
    evento: r.evento,
    firstMsgAt: r.first_msg_at,
    points: Number(r.points),
  }));

  return { error: null, rows };
}

// Histórico do contato de uma empresa num mês (RPC followup_company_history,
// SECURITY DEFINER com o mesmo gate do quadro). Para o painel lateral. A RPC
// devolve jsonb { relevant_day, days[], summary{} }.
export async function getCompanyHistory(
  companyId: string,
  month: string
): Promise<{ error: string | null; data?: CompanyHistory }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase.rpc("followup_company_history", {
    p_company: companyId,
    p_month: monthToDate(month),
  });
  if (error) return { error: error.message };

  const raw = (data ?? {}) as {
    relevant_day?: string;
    days?: {
      d: string;
      first_msg_at: string | null;
      contact_color: DayColor;
      color: DayColor;
      points: number;
      recovery_need: number;
      evento: string | null;
    }[];
    summary?: { reds: number; relapses: number; recoveries: number; situacao: string };
  };

  const days: ClientEventDay[] = (raw.days ?? []).map((r) => ({
    d: r.d,
    firstMsgAt: r.first_msg_at,
    contactColor: r.contact_color,
    color: r.color,
    points: Number(r.points),
    recoveryNeed: Number(r.recovery_need),
    evento: r.evento,
  }));

  return {
    error: null,
    data: {
      relevantDay: raw.relevant_day ?? "",
      days,
      summary: raw.summary ?? { reds: 0, relapses: 0, recoveries: 0, situacao: "" },
    },
  };
}
