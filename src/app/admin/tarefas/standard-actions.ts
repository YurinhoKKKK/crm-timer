"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type { TaskKind } from "@/lib/types";
import {
  applyCompanyStandards,
  applyStandardCompanies,
  type CompanyStandardAssignment,
  type StandardCompanyAssignment,
} from "@/lib/standard-link";

// Revalida todas as telas afetadas por uma mudança de vínculo empresa↔padrão.
function revalidateLinkPaths(companyId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/tarefas");
  revalidatePath("/admin/instancias");
  revalidatePath("/admin/empresas");
  revalidatePath("/consultor");
  if (companyId) {
    revalidatePath(`/admin/empresas/${companyId}`);
    revalidatePath(`/consultor/${companyId}`);
  }
}

// ---------------------------------------------------------------------------
// Passo 15 — Tarefas padrão (catálogo reutilizável)
// ---------------------------------------------------------------------------
// Duas famílias de ação:
//  1. CRUD do catálogo (standard_tasks) — só admin (a RLS st_admin_all reforça).
//  2. Atribuição a uma empresa — admin e consultor (a RLS de task_templates
//     reforça o escopo). Ao atribuir nasce um task_template ligado à padrão.
// ---------------------------------------------------------------------------

function normalize(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// 1. Catálogo (admin)
// ---------------------------------------------------------------------------

export type StandardTaskInput = {
  title: string;
  description: string;
  instructions: string;
  kind: TaskKind;
  dueTime: string; // HH:MM (opcional)
  weekdays: number[]; // 0-6 (só "diaria")
  active?: boolean; // aplicado na edição
};

type StandardFields = {
  title: string;
  description: string | null;
  instructions: string | null;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[];
};

function validateStandardInput(
  input: StandardTaskInput
): { error: string } | { fields: StandardFields } {
  const title = input.title.trim();
  if (!title) return { error: "Informe o título da tarefa padrão." };
  if (input.kind !== "unica" && input.kind !== "diaria") {
    return { error: "Tipo de tarefa inválido." };
  }

  const weekdays = Array.from(new Set(input.weekdays)).sort((a, b) => a - b);
  if (input.kind === "diaria" && weekdays.length === 0) {
    return { error: "Selecione ao menos um dia da semana." };
  }
  if (weekdays.some((d) => d < 0 || d > 6)) {
    return { error: "Dia da semana inválido." };
  }

  return {
    fields: {
      title,
      description: normalize(input.description),
      instructions: normalize(input.instructions),
      kind: input.kind,
      due_time: normalize(input.dueTime),
      weekdays: input.kind === "diaria" ? weekdays : [],
    },
  };
}

export async function createStandardTask(
  input: StandardTaskInput,
  // Direção 1 — já atribuir a padrão recém-criada às empresas escolhidas.
  companyAssignments: StandardCompanyAssignment[] = []
): Promise<{ error: string | null; id?: string }> {
  const result = validateStandardInput(input);
  if ("error" in result) return { error: result.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase
    .from("standard_tasks")
    .insert({ ...result.fields, created_by: user.id })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Não foi possível criar a tarefa padrão." };
  }

  if (companyAssignments.length > 0) {
    const linkErr = await applyStandardCompanies(
      supabase,
      user.id,
      data.id,
      companyAssignments
    );
    if (linkErr) {
      return {
        error: `Padrão criada, mas falhou ao atribuir às empresas: ${linkErr}`,
        id: data.id,
      };
    }
    revalidateLinkPaths();
  }

  revalidatePath("/admin/tarefas");
  return { error: null, id: data.id };
}

// Direção 1 — sincroniza em quais empresas uma tarefa padrão está atribuída
// (usado na edição da padrão). Reusa o mesmo núcleo do vínculo vivo.
export async function setStandardTaskCompanies(
  standardId: string,
  assignments: StandardCompanyAssignment[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const linkErr = await applyStandardCompanies(
    supabase,
    user.id,
    standardId,
    assignments
  );
  if (linkErr) return { error: linkErr };

  revalidateLinkPaths();
  return { error: null };
}

// Atualiza a padrão e propaga (sync_standard_task) para os templates ligados e
// suas instâncias ainda a_fazer, em todas as empresas. Finalizadas ficam
// congeladas (garantido pela função no banco).
export async function updateStandardTask(
  standardId: string,
  input: StandardTaskInput
): Promise<{ error: string | null }> {
  const result = validateStandardInput(input);
  if ("error" in result) return { error: result.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("standard_tasks")
    .update({ ...result.fields, active: input.active ?? true })
    .eq("id", standardId);

  if (error) return { error: error.message };

  const { error: syncError } = await supabase.rpc("sync_standard_task", {
    p_standard: standardId,
  });
  if (syncError) {
    return {
      error: `Padrão salva, mas falhou ao propagar: ${syncError.message}`,
    };
  }

  revalidatePath("/admin/tarefas");
  revalidatePath("/admin");
  revalidatePath("/admin/instancias");
  return { error: null };
}

// Exclui a padrão do catálogo. O FK standard_task_id é ON DELETE SET NULL:
// as tarefas já atribuídas/executadas nas empresas permanecem intactas (só
// perdem o vínculo vivo — não recebem mais atualizações da padrão).
export async function deleteStandardTask(
  standardId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("standard_tasks")
    .delete()
    .eq("id", standardId);

  if (error) return { error: error.message };

  revalidatePath("/admin/tarefas");
  return { error: null };
}

// ---------------------------------------------------------------------------
// 2. Atribuição a uma empresa (admin + consultor)
// ---------------------------------------------------------------------------

export type StandardAssignment = CompanyStandardAssignment;

// Direção 2 — sincroniza quais tarefas padrão a empresa usa. Toda a lógica
// (criar vínculo, trocar responsável, desativar quem saiu — respeitando o
// vínculo vivo e a regra de aparição no dia) mora no núcleo compartilhado.
// A RLS de task_templates garante que consultor só mexe nas empresas dele.
export async function setCompanyStandardTasks(
  companyId: string,
  assignments: StandardAssignment[]
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const linkErr = await applyCompanyStandards(
    supabase,
    user.id,
    companyId,
    assignments
  );
  if (linkErr) return { error: linkErr };

  revalidateLinkPaths(companyId);
  return { error: null };
}
