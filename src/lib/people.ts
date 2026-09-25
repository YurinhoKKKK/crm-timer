import type { createClient } from "@/lib/supabase-server";

export type PersonOption = { id: string; full_name: string; email: string };

// Mapa empresa → ids dos colaboradores RESPONSÁVEIS (vínculo declarado — âncora
// 0090). Alimenta o filtro do seletor de responsável no cadastro de tarefa: só
// quem é responsável pela empresa pode receber tarefa nela (o servidor também
// valida). A RLS (ccol_select) já escopa o que o chamador enxerga — admin vê
// tudo; consultor vê suas empresas. `companyIds` restringe a consulta quando o
// chamador só precisa de algumas (ex.: a tela de uma empresa).
export async function loadResponsiblesByCompany(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyIds?: string[]
): Promise<Record<string, string[]>> {
  let query = supabase
    .from("company_collaborators")
    .select("company_id, collaborator_id");
  if (companyIds && companyIds.length > 0) {
    query = query.in("company_id", companyIds);
  }
  const { data } = await query;
  const map: Record<string, string[]> = {};
  for (const row of (data as { company_id: string; collaborator_id: string }[]) ?? []) {
    (map[row.company_id] ??= []).push(row.collaborator_id);
  }
  return map;
}

// Acrescenta o próprio usuário ao topo de uma lista de pessoas, marcado com
// "(você)". Usado para que admin/consultor possam se autoatribuir como
// responsável de tarefas (Passo 14) ou, no caso do admin, como consultor de
// uma empresa. Se o usuário já estiver na lista, devolve-a inalterada.
export function withSelf(
  list: PersonOption[],
  self: { id: string; full_name: string }
): PersonOption[] {
  if (list.some((p) => p.id === self.id)) return list;
  return [
    { id: self.id, full_name: `${self.full_name} (você)`, email: "" },
    ...list,
  ];
}
