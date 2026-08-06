import type { createClient } from "@/lib/supabase-server";

// Acompanhamento de clientes — tipos e helpers da tela que responde "quais
// clientes estão esfriando?". A agregação pesada mora no banco (RPC
// client_followup, SECURITY INVOKER escopada por companies_select); aqui só
// tipamos o retorno e derivamos o semáforo.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type FollowupKind =
  | "reuniao"
  | "anotacao"
  | "listagem"
  | "reajuste"
  | "tarefa";

export type FollowupConsultant = {
  id: string;
  name: string | null;
  avatarPath: string | null;
};

export type FollowupRow = {
  companyId: string;
  companyName: string;
  consultants: FollowupConsultant[];
  lastContactAt: string | null; // ISO; null = nunca houve contato
  lastContactKind: FollowupKind | null;
  daysSince: number | null; // dias civis (BRT); null = nunca
  nextMeetingAt: string | null; // próxima reunião MARCADA (futuro)
  period: {
    meetings: number;
    notes: number;
    listings: number;
    readjusts: number;
    tasks: number;
  };
};

export type Farol = "verde" | "amarelo" | "vermelho";

export const FOLLOWUP_PERIODS = [30, 60, 90] as const;
export type FollowupPeriod = (typeof FOLLOWUP_PERIODS)[number];

export function clampPeriod(raw: string | string[] | undefined): FollowupPeriod {
  const v = parseInt((Array.isArray(raw) ? raw[0] : raw) ?? "", 10);
  return (FOLLOWUP_PERIODS as readonly number[]).includes(v)
    ? (v as FollowupPeriod)
    : 30;
}

// Sentido da MESMA fila de prioridade (não é troca de critério). Descendente por
// urgência é o padrão (mais críticos no topo); `dir=asc` na URL inverte para os
// atendidos mais recentemente no topo. Retorna `p_desc` para a RPC.
export function clampDir(raw: string | string[] | undefined): boolean {
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return v !== "asc"; // qualquer coisa fora de "asc" = descendente (padrão)
}

// Semáforo pelos prazos definidos: verde até 7 dias, amarelo de 7 a 15, vermelho
// acima de 15. Nunca contatado é o caso mais urgente → vermelho (a tela mostra o
// texto "Nunca contatado", não um número). O texto SEMPRE acompanha a cor
// (acessibilidade): a cor nunca é o único sinal.
export function farolOf(days: number | null): Farol {
  if (days === null) return "vermelho";
  if (days <= 7) return "verde";
  if (days <= 15) return "amarelo";
  return "vermelho";
}

export const KIND_LABEL: Record<FollowupKind, string> = {
  reuniao: "Reunião realizada",
  anotacao: "Anotação ao cliente",
  listagem: "Listagem entregue",
  reajuste: "Reajuste concluído",
  tarefa: "Tarefa concluída",
};

// Carrega o acompanhamento do período. A RLS (companies_select) já escopa: admin
// vê todas; consultor só a carteira dele. Uma linha por empresa (bounded pelo nº
// de empresas do escopo — nunca linhas cruas de sinais).
export async function loadFollowup(
  supabase: SupabaseServer,
  periodDays: FollowupPeriod,
  desc: boolean
): Promise<FollowupRow[]> {
  const { data } = await supabase.rpc("client_followup", {
    p_period_days: periodDays,
    p_desc: desc,
  });
  const rows =
    (data as
      | {
          company_id: string;
          company_name: string;
          consultants: { id: string; name: string | null; avatar_path: string | null }[] | null;
          last_contact_at: string | null;
          last_contact_kind: FollowupKind | null;
          days_since: number | null;
          next_meeting_at: string | null;
          period_meetings: number;
          period_notes: number;
          period_listings: number;
          period_readjusts: number;
          period_tasks: number;
        }[]
      | null) ?? [];

  return rows.map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    consultants: (r.consultants ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      avatarPath: c.avatar_path,
    })),
    lastContactAt: r.last_contact_at,
    lastContactKind: r.last_contact_kind,
    daysSince: r.days_since,
    nextMeetingAt: r.next_meeting_at,
    period: {
      meetings: Number(r.period_meetings),
      notes: Number(r.period_notes),
      listings: Number(r.period_listings),
      readjusts: Number(r.period_readjusts),
      tasks: Number(r.period_tasks),
    },
  }));
}
