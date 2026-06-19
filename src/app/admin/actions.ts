"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type { Role } from "@/lib/types";

const VALID_ROLES: Role[] = ["pending", "colaborador", "consultor", "admin"];

// Altera o cargo de um usuário. A RLS (policy profiles_update_self → with check
// is_admin()) garante que somente um admin consegue mudar o cargo de terceiros;
// validamos o cargo aqui para evitar valores inválidos.
export async function updateUserRole(
  userId: string,
  role: Role
): Promise<{ error: string | null }> {
  if (!VALID_ROLES.includes(role)) {
    return { error: "Cargo inválido." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/usuarios");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Empresas (Passo 2.2)
// ---------------------------------------------------------------------------

type CompanyInput = {
  name: string;
  whatsappContactId: string;
  whatsappGroupName: string;
  consultantIds: string[];
};

function normalize(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Cria uma empresa e (opcionalmente) já vincula consultores. A RLS
// (companies_admin_all / cc_admin_all) garante que só o admin escreve aqui.
export async function createCompany(
  input: CompanyInput
): Promise<{ error: string | null; id?: string }> {
  const name = input.name.trim();
  if (!name) {
    return { error: "Informe o nome da empresa." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      name,
      whatsapp_contact_id: normalize(input.whatsappContactId),
      whatsapp_group_name: normalize(input.whatsappGroupName),
    })
    .select("id")
    .single();

  if (error || !company) {
    return { error: error?.message ?? "Não foi possível criar a empresa." };
  }

  const consultantIds = Array.from(new Set(input.consultantIds));
  if (consultantIds.length > 0) {
    const { error: linkError } = await supabase
      .from("company_consultants")
      .insert(
        consultantIds.map((consultantId) => ({
          company_id: company.id,
          consultant_id: consultantId,
        }))
      );

    if (linkError) {
      return { error: linkError.message, id: company.id };
    }
  }

  revalidatePath("/admin/empresas");
  return { error: null, id: company.id };
}

// Substitui o conjunto de consultores de uma empresa pelo informado:
// remove os vínculos atuais e insere os novos.
export async function setCompanyConsultants(
  companyId: string,
  consultantIds: string[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error: deleteError } = await supabase
    .from("company_consultants")
    .delete()
    .eq("company_id", companyId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  const ids = Array.from(new Set(consultantIds));
  if (ids.length > 0) {
    const { error: insertError } = await supabase
      .from("company_consultants")
      .insert(
        ids.map((consultantId) => ({
          company_id: companyId,
          consultant_id: consultantId,
        }))
      );

    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath("/admin/empresas");
  return { error: null };
}
