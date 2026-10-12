import type { createClient } from "@/lib/supabase-server";
import { type CompanyGroup } from "@/lib/company-groups";

// =====================================================================
// Quadro "Desenvolvimento" (Etapa 1) — helpers de servidor.
//
// O Desenvolvimento é uma VISÃO sobre as mesmas empresas do quadro de Empresas,
// com GRUPOS PRÓPRIOS (dev_groups) e SEM nenhuma sincronização: toda movimentação
// é manual. Nada é copiado. A RPC dev_board() entrega o grupo JÁ RESOLVIDO (com o
// padrão Lista de Espera), então aqui só precisamos carregar os grupos para as
// seções e o menu "Mover para...".
// =====================================================================

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Grupo do Desenvolvimento (tabela dev_groups). Sem `kind` — o fluxo automático
// dos grupos de Empresas não se aplica aqui.
export type DevGroup = {
  id: string;
  name: string;
  color: string;
  position: number;
};

// Grupos do Desenvolvimento na ordem de exibição. RLS: só admin lê nesta etapa.
export async function loadDevGroups(
  supabase: SupabaseServer
): Promise<DevGroup[]> {
  const { data } = await supabase
    .from("dev_groups")
    .select("id, name, color, position")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data as DevGroup[]) ?? [];
}

// Adapta um grupo do Desenvolvimento à casca visual compartilhada (GroupSection /
// groupCompanies), que fala CompanyGroup. `kind` é irrelevante aqui → 'neutral'.
export function asCompanyGroup(g: DevGroup): CompanyGroup {
  return { id: g.id, name: g.name, color: g.color, position: g.position, kind: "neutral" };
}
