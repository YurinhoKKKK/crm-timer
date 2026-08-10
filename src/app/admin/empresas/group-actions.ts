"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import {
  normalizeGroupColor,
  isValidGroupColor,
  type CompanyGroup,
} from "@/lib/company-groups";

// =====================================================================
// Ações dos grupos de empresas (tela do admin). Tudo admin-only — a RLS
// (cg_* / companies_admin_all) é a fronteira real; estas ações só dão erros
// amigáveis e mantêm a escrita de group_id em LOTE (RPC set_companies_group),
// nunca N idas do navegador. Ver [[reunioes]]/[[dashboard]] só como estilo.
// =====================================================================

const SESSION_MSG = "Sessão expirada. Faça login novamente.";
const DUP_NAME_MSG = "Já existe um grupo com esse nome.";
const NAME_EMPTY_MSG = "Informe o nome do grupo.";
const NAME_LONG_MSG = "O nome do grupo deve ter até 40 caracteres.";
const COLOR_MSG = "Escolha uma cor válida (hex #RRGGBB).";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function validateName(raw: string): { name?: string; error?: string } {
  const name = raw.trim();
  if (!name) return { error: NAME_EMPTY_MSG };
  if (name.length > 40) return { error: NAME_LONG_MSG };
  return { name };
}

// 23505 = unique_violation (índice case-insensitive do nome). Traduz para um
// aviso claro na tela em vez de vazar o erro cru do Postgres.
function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export async function createGroup(input: {
  name: string;
  color: string;
}): Promise<{ error: string | null; group?: CompanyGroup }> {
  const { name, error: nameError } = validateName(input.name);
  if (nameError) return { error: nameError };
  if (!isValidGroupColor(input.color)) return { error: COLOR_MSG };

  const { supabase, user } = await requireUser();
  if (!user) return { error: SESSION_MSG };

  // Próxima posição = fim da lista. Position não é único; corridas entre dois
  // admins não quebram nada e o reordenar conserta a ordem.
  const { data: last } = await supabase
    .from("company_groups")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = ((last as { position: number } | null)?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from("company_groups")
    .insert({
      name: name!,
      color: normalizeGroupColor(input.color),
      position: nextPosition,
      created_by: user.id,
    })
    .select("id, name, color, position")
    .single();

  if (error || !data) {
    if (isDuplicate(error)) return { error: DUP_NAME_MSG };
    return { error: error?.message ?? "Não foi possível criar o grupo." };
  }
  revalidatePath("/admin/empresas");
  return { error: null, group: data as CompanyGroup };
}

// Edita nome e/ou cor (o diálogo "Editar grupo" carrega os dois campos; os itens
// de menu "Renomear" e "Trocar cor" abrem o mesmo diálogo). Uma ida só.
export async function updateGroup(
  groupId: string,
  input: { name: string; color: string }
): Promise<{ error: string | null }> {
  const { name, error: nameError } = validateName(input.name);
  if (nameError) return { error: nameError };
  if (!isValidGroupColor(input.color)) return { error: COLOR_MSG };

  const { supabase, user } = await requireUser();
  if (!user) return { error: SESSION_MSG };

  const { error } = await supabase
    .from("company_groups")
    .update({ name: name!, color: normalizeGroupColor(input.color) })
    .eq("id", groupId);
  if (error) {
    if (isDuplicate(error)) return { error: DUP_NAME_MSG };
    return { error: error.message };
  }
  revalidatePath("/admin/empresas");
  return { error: null };
}

// Grava position pela ordem do array (RPC em lote). Usado por "mover p/ cima" /
// "mover p/ baixo": a tela calcula a nova ordem inteira e manda de uma vez.
export async function reorderGroups(
  ids: string[]
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: SESSION_MSG };

  const { error } = await supabase.rpc("reorder_company_groups", {
    p_ids: ids,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/empresas");
  return { error: null };
}

// Excluir NÃO apaga empresas: o on delete set null devolve as N empresas do
// grupo para "Sem grupo".
export async function deleteGroup(
  groupId: string
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: SESSION_MSG };

  const { error } = await supabase
    .from("company_groups")
    .delete()
    .eq("id", groupId);
  if (error) return { error: error.message };
  revalidatePath("/admin/empresas");
  return { error: null };
}

// Move um conjunto de empresas para um grupo (groupId null = "Sem grupo"), em
// UMA chamada só (RPC set_companies_group). Devolve quantas linhas foram REALMENTE
// afetadas junto do que foi pedido, para a tela avisar (e reverter o otimista) se
// o RLS barrou parte da seleção em vez de mentir sucesso.
export async function moveCompanies(
  companyIds: string[],
  groupId: string | null
): Promise<{ error: string | null; moved: number; requested: number }> {
  const requested = companyIds.length;
  if (requested === 0) return { error: null, moved: 0, requested: 0 };

  const { supabase, user } = await requireUser();
  if (!user) return { error: SESSION_MSG, moved: 0, requested };

  const { data, error } = await supabase.rpc("set_companies_group", {
    p_company_ids: companyIds,
    p_group_id: groupId,
  });
  if (error) return { error: error.message, moved: 0, requested };

  const moved = typeof data === "number" ? data : 0;
  revalidatePath("/admin/empresas");
  return { error: null, moved, requested };
}
