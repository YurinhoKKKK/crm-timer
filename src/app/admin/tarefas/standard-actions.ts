"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import type { TaskKind, TablesInsert } from "@/lib/types";

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
  input: StandardTaskInput
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

  revalidatePath("/admin/tarefas");
  return { error: null, id: data.id };
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

export type StandardAssignment = {
  standardId: string;
  collaboratorId: string;
  startDate?: string; // YYYY-MM-DD, só relevante para padrões "unica"
};

// Sincroniza quais tarefas padrão a empresa usa:
//  - Padrão nova na lista  -> cria um task_template ligado (o trigger gera a
//    instância "unica"; a "diaria" entra na recorrência do generate_daily_tasks).
//  - Padrão que saiu da lista -> desativa o template (active=false, para de
//    gerar/atualizar) e remove as instâncias ainda a_fazer. As finalizadas
//    permanecem no histórico, ligadas ao template desativado.
//  - Padrão que continua, com responsável trocado -> atualiza o collaborator_id
//    do template e propaga (sync_template_instances) para as instâncias a_fazer.
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

  // Templates já ligados a padrões nesta empresa (ativos e inativos).
  const { data: existingData, error: existingError } = await supabase
    .from("task_templates")
    .select("id, standard_task_id, active, collaborator_id")
    .eq("company_id", companyId)
    .not("standard_task_id", "is", null);
  if (existingError) return { error: existingError.message };

  // Considera "atual" apenas o template ATIVO de cada padrão (pode haver
  // inativos antigos guardando histórico finalizado).
  const activeByStandard = new Map<
    string,
    { id: string; collaborator_id: string }
  >();
  for (const t of existingData ?? []) {
    if (t.active && t.standard_task_id) {
      activeByStandard.set(t.standard_task_id, {
        id: t.id,
        collaborator_id: t.collaborator_id,
      });
    }
  }

  const desired = new Map<string, StandardAssignment>();
  for (const a of assignments) {
    if (a.standardId && a.collaboratorId) desired.set(a.standardId, a);
  }

  // (a) Desativar os que saíram da lista + remover instâncias a_fazer.
  for (const [standardId, tmpl] of Array.from(activeByStandard.entries())) {
    if (desired.has(standardId)) continue;
    const { error: deactErr } = await supabase
      .from("task_templates")
      .update({ active: false })
      .eq("id", tmpl.id);
    if (deactErr) return { error: deactErr.message };

    const { error: delErr } = await supabase
      .from("task_instances")
      .delete()
      .eq("template_id", tmpl.id)
      .eq("status", "a_fazer");
    if (delErr) return { error: delErr.message };
  }

  // Campos-molde das padrões que precisamos criar do zero.
  const toCreate = Array.from(desired.values()).filter(
    (a) => !activeByStandard.has(a.standardId)
  );
  let standards: Record<string, {
    title: string;
    description: string | null;
    instructions: string | null;
    kind: TaskKind;
    weekdays: number[] | null;
    due_time: string | null;
  }> = {};
  if (toCreate.length > 0) {
    const { data: stdData, error: stdError } = await supabase
      .from("standard_tasks")
      .select("id, title, description, instructions, kind, weekdays, due_time")
      .in(
        "id",
        toCreate.map((a) => a.standardId)
      );
    if (stdError) return { error: stdError.message };
    standards = Object.fromEntries(
      (stdData ?? []).map((s) => [s.id, s])
    ) as typeof standards;
  }

  // (b) Criar / (c) atualizar responsável dos que continuam.
  for (const [standardId, assignment] of Array.from(desired.entries())) {
    const active = activeByStandard.get(standardId);

    if (active) {
      // Continua: só age se trocou o responsável.
      if (active.collaborator_id !== assignment.collaboratorId) {
        const { error: updErr } = await supabase
          .from("task_templates")
          .update({ collaborator_id: assignment.collaboratorId })
          .eq("id", active.id);
        if (updErr) return { error: updErr.message };
        // Propaga o novo responsável às instâncias a_fazer.
        const { error: syncErr } = await supabase.rpc(
          "sync_template_instances",
          { p_template: active.id }
        );
        if (syncErr) return { error: syncErr.message };
      }
      continue;
    }

    // Novo vínculo: cria o task_template a partir da padrão.
    const std = standards[standardId];
    if (!std) return { error: "Tarefa padrão não encontrada." };

    const row: TablesInsert<"task_templates"> = {
      company_id: companyId,
      collaborator_id: assignment.collaboratorId,
      created_by: user.id,
      standard_task_id: standardId,
      title: std.title,
      description: std.description,
      instructions: std.instructions,
      kind: std.kind,
      weekdays: std.kind === "diaria" ? std.weekdays ?? [] : [],
      due_time: std.due_time,
      start_date:
        std.kind === "unica" ? assignment.startDate || todayISO() : todayISO(),
    };

    const { error: insErr } = await supabase
      .from("task_templates")
      .insert(row);
    if (insErr) return { error: insErr.message };
  }

  revalidatePath(`/admin/empresas/${companyId}`);
  revalidatePath(`/consultor/${companyId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/tarefas");
  revalidatePath("/admin/instancias");
  revalidatePath("/consultor");
  return { error: null };
}
