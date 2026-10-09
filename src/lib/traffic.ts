import type { createClient } from "@/lib/supabase-server";
import {
  resolveCompanyGroupId,
  type CompanyGroup,
} from "@/lib/company-groups";

// =====================================================================
// Quadro "Tráfego" (Fatia 1) — helpers de servidor + resolução de grupo.
//
// O Tráfego é uma VISÃO sobre as mesmas empresas do quadro de Empresas, com
// GRUPOS PRÓPRIOS (traffic_groups) e uma correspondência Empresas->Tráfego
// guardada em company_groups.traffic_group_id. Nada é copiado.
// =====================================================================

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Grupo do Tráfego (tabela traffic_groups). Sem `kind` — o fluxo automático dos
// grupos de Empresas não se aplica aqui.
export type TrafficGroup = {
  id: string;
  name: string;
  color: string;
  position: number;
};

// Linha por empresa COM 'trafego' (vinda da RPC traffic_board). `synced` = o modo
// calculado (sincronizada com Empresas quando também tem marketplace).
export type TrafficRow = {
  id: string;
  name: string;
  groupId: string | null; // grupo de EMPRESAS (passa por resolveCompanyGroupId)
  synced: boolean;
  monthsTotal: number | null;
  periodDays: number | null;
  // Grupo escolhido À MÃO no Tráfego (company_traffic.manual_group_id) — só vale
  // no modo manual; nas sincronizadas é ignorado pelo helper de grupo.
  manualTrafficGroupId: string | null;
};

// Grupos do Tráfego na ordem de exibição. RLS: só admin lê nesta fatia.
export async function loadTrafficGroups(
  supabase: SupabaseServer
): Promise<TrafficGroup[]> {
  const { data } = await supabase
    .from("traffic_groups")
    .select("id, name, color, position")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data as TrafficGroup[]) ?? [];
}

// Adapta um grupo do Tráfego à casca visual compartilhada (GroupSection /
// groupCompanies), que fala CompanyGroup. `kind` é irrelevante aqui → 'neutral'.
export function asCompanyGroup(g: TrafficGroup): CompanyGroup {
  return { id: g.id, name: g.name, color: g.color, position: g.position, kind: "neutral" };
}

// ÚNICO ponto que decide o grupo de uma empresa NO TRÁFEGO (fonte única):
//   · sincronizada → correspondência do grupo de Empresas (manual_group_id é
//     IGNORADO, pois acompanha o quadro de Empresas);
//   · manual → coalesce(manual_group_id, correspondência do grupo de Empresas).
// A correspondência é SEMPRE resolvida por resolveCompanyGroupId. Sem grupo de
// Empresas / sem correspondência / sem escolha manual → null ("Sem grupo").
export function resolveTrafficGroupId(
  row: { groupId: string | null; synced: boolean; manualTrafficGroupId: string | null },
  correspondence: Map<string, string | null>
): string | null {
  const empresaGroupId = resolveCompanyGroupId({ group_id: row.groupId });
  const corresp = empresaGroupId ? correspondence.get(empresaGroupId) ?? null : null;
  if (row.synced) return corresp;
  return row.manualTrafficGroupId ?? corresp;
}
