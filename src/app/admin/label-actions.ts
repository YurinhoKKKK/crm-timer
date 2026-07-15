"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type { Label } from "@/lib/labels";

// Ações das etiquetas (Passo 20).
//  - Catálogo (labels): só admin gerencia — a RLS labels_admin_all reforça.
//  - Atribuição (company_labels): admin ou consultor da empresa — RLS cl_manage.
// A herança nas tarefas é em tempo real (leitura junta por company_id), então
// não há nada a "propagar" ao mudar etiquetas: as telas releem e refletem.

function normalizeColor(value: string, fallback: string): string {
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : fallback;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// --- Catálogo ---------------------------------------------------------------

export async function createLabel(input: {
  name: string;
  bgColor: string;
  textColor: string;
  highlight?: boolean;
}): Promise<{ error: string | null; label?: Label }> {
  const name = input.name.trim();
  if (!name) return { error: "Informe o nome da etiqueta." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase
    .from("labels")
    .insert({
      name,
      bg_color: normalizeColor(input.bgColor, "#2B333B"),
      text_color: normalizeColor(input.textColor, "#FFFFFF"),
      highlight: !!input.highlight,
      created_by: user.id,
    })
    .select("id, name, bg_color, text_color, highlight")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Não foi possível criar a etiqueta." };
  }
  revalidatePath("/admin/empresas");
  return { error: null, label: data as Label };
}

export async function updateLabel(
  labelId: string,
  input: { name: string; bgColor: string; textColor: string; highlight?: boolean }
): Promise<{ error: string | null; label?: Label }> {
  const name = input.name.trim();
  if (!name) return { error: "Informe o nome da etiqueta." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase
    .from("labels")
    .update({
      name,
      bg_color: normalizeColor(input.bgColor, "#2B333B"),
      text_color: normalizeColor(input.textColor, "#FFFFFF"),
      highlight: !!input.highlight,
    })
    .eq("id", labelId)
    .select("id, name, bg_color, text_color, highlight")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Não foi possível salvar a etiqueta." };
  }
  revalidatePath("/admin/empresas");
  return { error: null, label: data as Label };
}

// Remover a etiqueta do catálogo tira ela de todas as empresas (cascade em
// company_labels) e, por consequência, de todas as tarefas (herança).
export async function deleteLabel(
  labelId: string
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("labels").delete().eq("id", labelId);
  if (error) return { error: error.message };
  revalidatePath("/admin/empresas");
  return { error: null };
}

// --- Atribuição por empresa -------------------------------------------------

// Substitui o conjunto de etiquetas de uma empresa pelo informado. Retroativo
// e automático: como as tarefas herdam por company_id, marcar/desmarcar aqui
// muda o que aparece em todas as tarefas da empresa imediatamente.
export async function setCompanyLabels(
  companyId: string,
  labelIds: string[]
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error: delError } = await supabase
    .from("company_labels")
    .delete()
    .eq("company_id", companyId);
  if (delError) return { error: delError.message };

  const ids = Array.from(new Set(labelIds));
  if (ids.length > 0) {
    const { error: insError } = await supabase
      .from("company_labels")
      .insert(ids.map((label_id) => ({ company_id: companyId, label_id })));
    if (insError) return { error: insError.message };
  }

  revalidatePath("/admin/empresas");
  revalidatePath(`/admin/empresas/${companyId}`);
  revalidatePath(`/admin/empresas/${companyId}/editar`);
  return { error: null };
}
