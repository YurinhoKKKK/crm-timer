"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type { Role, TaskKind, TablesInsert } from "@/lib/types";
import {
  applyCompanyStandards,
  type CompanyStandardAssignment,
} from "@/lib/standard-link";

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

const DUPLICATE_COMPANY_MSG = "Já existe uma empresa com esse nome.";

type MaybeClient = Awaited<ReturnType<typeof createClient>>;

// Checa se o nome já está em uso, com a MESMA regra do índice único do banco
// (companies_name_unique_ci): ignora maiúsculas/minúsculas e espaços nas
// bordas. Pré-checagem para dar mensagem clara; a constraint é a garantia real.
async function companyNameTaken(
  supabase: MaybeClient,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const target = name.trim().toLowerCase();
  if (!target) return false;
  // ilike sem curingas = igualdade case-insensitive; escapamos %/_/\ do nome.
  const pattern = name.trim().replace(/([\\%_])/g, "\\$1");
  const { data } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", pattern);
  return ((data as { id: string; name: string }[]) ?? []).some(
    (c) => c.id !== excludeId && c.name.trim().toLowerCase() === target
  );
}

// Cria uma empresa e (opcionalmente) já vincula consultores. A RLS
// (companies_admin_all / cc_admin_all) garante que só o admin escreve aqui.
// `standardAssignments` (Direção 2) já atribui tarefas padrão à empresa nova,
// pelo mesmo núcleo do vínculo vivo (regra de aparição no dia incluída).
export async function createCompany(
  input: CompanyInput,
  standardAssignments: CompanyStandardAssignment[] = [],
  labelIds: string[] = []
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

  if (await companyNameTaken(supabase, name)) {
    return { error: DUPLICATE_COMPANY_MSG };
  }

  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      name,
      whatsapp_contact_id: normalize(input.whatsappContactId),
      whatsapp_group_name: normalize(input.whatsappGroupName),
      created_by: user.id, // transparência: quem cadastrou a empresa
    })
    .select("id")
    .single();

  if (error || !company) {
    // 23505 = violação de unicidade (corrida/duplo-submit escapou da pré-checagem).
    if (error?.code === "23505") return { error: DUPLICATE_COMPANY_MSG };
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

  const labels = Array.from(new Set(labelIds));
  if (labels.length > 0) {
    const { error: labelError } = await supabase
      .from("company_labels")
      .insert(labels.map((label_id) => ({ company_id: company.id, label_id })));
    if (labelError) {
      return {
        error: `Empresa criada, mas falhou ao aplicar etiquetas: ${labelError.message}`,
        id: company.id,
      };
    }
  }

  if (standardAssignments.length > 0) {
    const linkErr = await applyCompanyStandards(
      supabase,
      user.id,
      company.id,
      standardAssignments
    );
    if (linkErr) {
      return {
        error: `Empresa criada, mas falhou ao atribuir tarefas padrão: ${linkErr}`,
        id: company.id,
      };
    }
    revalidatePath("/admin");
    revalidatePath("/admin/tarefas");
    revalidatePath("/admin/instancias");
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

// Atualiza os dados básicos de uma empresa (consultores são geridos por
// setCompanyConsultants).
export async function updateCompany(
  companyId: string,
  input: { name: string; whatsappContactId: string; whatsappGroupName: string }
): Promise<{ error: string | null }> {
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

  // Não deixa renomear para o nome de OUTRA empresa (exclui a própria).
  if (await companyNameTaken(supabase, name, companyId)) {
    return { error: DUPLICATE_COMPANY_MSG };
  }

  const { error } = await supabase
    .from("companies")
    .update({
      name,
      whatsapp_contact_id: normalize(input.whatsappContactId),
      whatsapp_group_name: normalize(input.whatsappGroupName),
    })
    .eq("id", companyId);

  if (error) {
    if (error.code === "23505") return { error: DUPLICATE_COMPANY_MSG };
    return { error: error.message };
  }

  revalidatePath("/admin/empresas");
  revalidatePath(`/admin/empresas/${companyId}`);
  return { error: null };
}

// Exclui uma empresa. ATENÇÃO: o cascade do banco remove também os vínculos
// de consultores, os templates e as instâncias de tarefa dessa empresa.
export async function deleteCompany(
  companyId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase.from("companies").delete().eq("id", companyId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/empresas");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Tarefas (Passo 2.3)
// ---------------------------------------------------------------------------

type TaskTemplateInput = {
  title: string;
  description: string;
  instructions: string;
  companyId: string;
  collaboratorId: string;
  kind: TaskKind;
  startDate: string; // YYYY-MM-DD (usado em "unica")
  dueTime: string; // HH:MM (opcional)
  weekdays: number[]; // 0-6 (usado em "diaria")
  endDate: string; // YYYY-MM-DD (opcional, "diaria")
  active?: boolean; // só aplicado na edição
};

type TemplateFields = {
  title: string;
  description: string | null;
  instructions: string | null;
  company_id: string;
  collaborator_id: string;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[] | null;
  end_date: string | null;
  start_date?: string;
};

// Valida e normaliza a entrada do formulário de tarefa, compartilhado por
// criar e editar. Retorna os campos prontos para gravar ou uma mensagem.
function validateTemplateInput(
  input: TaskTemplateInput
): { error: string } | { fields: TemplateFields } {
  const title = input.title.trim();
  if (!title) return { error: "Informe o título da tarefa." };
  if (!input.companyId) return { error: "Selecione a empresa." };
  if (!input.collaboratorId) return { error: "Selecione o colaborador." };
  if (input.kind !== "unica" && input.kind !== "diaria") {
    return { error: "Tipo de tarefa inválido." };
  }

  const weekdays = Array.from(new Set(input.weekdays)).sort((a, b) => a - b);

  if (input.kind === "unica" && !input.startDate) {
    return { error: "Informe a data da tarefa única." };
  }
  if (input.kind === "diaria" && weekdays.length === 0) {
    return { error: "Selecione ao menos um dia da semana." };
  }
  if (weekdays.some((d) => d < 0 || d > 6)) {
    return { error: "Dia da semana inválido." };
  }

  const fields: TemplateFields = {
    title,
    description: normalize(input.description),
    instructions: normalize(input.instructions),
    company_id: input.companyId,
    collaborator_id: input.collaboratorId,
    kind: input.kind,
    due_time: normalize(input.dueTime),
    weekdays: input.kind === "unica" ? null : weekdays,
    end_date: input.kind === "unica" ? null : normalize(input.endDate),
  };
  if (input.kind === "unica" || input.startDate) {
    fields.start_date = input.startDate;
  }

  return { fields };
}

// Cria um task_template. Os triggers do banco cuidam das instâncias:
// "unica" gera a task_instance na hora (trg_unique_template); "diaria" é
// materializada por generate_daily_tasks conforme os weekdays.
export async function createTaskTemplate(
  input: TaskTemplateInput
): Promise<{ error: string | null; id?: string }> {
  const result = validateTemplateInput(input);
  if ("error" in result) {
    return { error: result.error };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const row: TablesInsert<"task_templates"> = {
    ...result.fields,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from("task_templates")
    .insert(row)
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Não foi possível criar a tarefa." };
  }

  revalidatePath("/admin/tarefas");
  return { error: null, id: data.id };
}

// Atualiza um task_template existente. Obs.: a edição NÃO altera instâncias já
// geradas — vale para as próximas gerações da tarefa.
export async function updateTaskTemplate(
  templateId: string,
  input: TaskTemplateInput
): Promise<{ error: string | null }> {
  const result = validateTemplateInput(input);
  if ("error" in result) {
    return { error: result.error };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase
    .from("task_templates")
    .update({ ...result.fields, active: input.active ?? true })
    .eq("id", templateId);

  if (error) {
    return { error: error.message };
  }

  // Propaga a edição para as instâncias ainda não iniciadas (a_fazer).
  const { error: syncError } = await supabase.rpc("sync_template_instances", {
    p_template: templateId,
  });
  if (syncError) {
    return { error: `Tarefa salva, mas falhou ao propagar: ${syncError.message}` };
  }

  revalidatePath("/admin/tarefas");
  revalidatePath(`/admin/tarefas/${templateId}`);
  return { error: null };
}

// Exclui um task_template e, em cascata (migration 0008), todas as suas
// task_instances, time_entries e activity_log relacionados — some de todos
// os painéis e dos números do dashboard/resumo. A RLS (tt_delete) garante
// que admin exclui qualquer um e consultor só os que ele criou.
export async function deleteTaskTemplate(
  templateId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase
    .from("task_templates")
    .delete()
    .eq("id", templateId);

  if (error) {
    return { error: error.message };
  }

  // Reflete nas listagens e nos números agregados (dashboard, instâncias).
  revalidatePath("/admin");
  revalidatePath("/admin/tarefas");
  revalidatePath("/admin/instancias");
  return { error: null };
}
