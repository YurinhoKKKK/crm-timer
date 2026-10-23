"use server";

import { createClient } from "@/lib/supabase-server";
import { monthToDate, type DayColor, type ScoreDetailRow } from "@/lib/followup";

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
          color: DayColor;
          first_msg_at: string | null;
          points: number;
        }[]
      | null) ?? []
  ).map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    day: r.d,
    color: r.color,
    firstMsgAt: r.first_msg_at,
    points: Number(r.points),
  }));

  return { error: null, rows };
}
