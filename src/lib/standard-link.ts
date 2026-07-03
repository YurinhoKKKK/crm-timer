// ---------------------------------------------------------------------------
// Núcleo compartilhado do vínculo empresa ↔ tarefa padrão (Passo 20)
// ---------------------------------------------------------------------------
// A relação "empresa X usa a tarefa padrão Y (com o responsável Z)" é
// representada por UM task_template ATIVO com (standard_task_id, company_id,
// collaborator_id). As duas direções do fluxo (escolher padrões dentro da
// empresa; escolher empresas dentro da padrão) mexem exatamente nessa mesma
// linha — então centralizamos aqui toda a mutação, e ambas ficam coerentes por
// construção.
//
// Este módulo roda sempre no servidor (importado só por server actions) e
// respeita o RLS de task_templates: o cliente autenticado é passado por quem
// chama. Nada de "use server" aqui — são helpers, não server actions.
// ---------------------------------------------------------------------------

import type { createClient } from "./supabase-server";
import type { TaskKind, TablesInsert } from "./types";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Campos-molde de uma tarefa padrão, copiados para o task_template ao criar o
// vínculo.
type StandardMold = {
  title: string;
  description: string | null;
  instructions: string | null;
  kind: TaskKind;
  weekdays: number[] | null;
  due_time: string | null;
};

async function fetchMolds(
  supabase: ServerClient,
  ids: string[]
): Promise<{ error: string } | { molds: Map<string, StandardMold> }> {
  if (ids.length === 0) return { molds: new Map() };
  const { data, error } = await supabase
    .from("standard_tasks")
    .select("id, title, description, instructions, kind, weekdays, due_time")
    .in("id", ids);
  if (error) return { error: error.message };
  const molds = new Map<string, StandardMold>();
  for (const s of data ?? []) {
    molds.set(s.id, {
      title: s.title,
      description: s.description,
      instructions: s.instructions,
      kind: s.kind,
      weekdays: s.weekdays,
      due_time: s.due_time,
    });
  }
  return { molds };
}

// Desativa o template (para de gerar/atualizar) e remove as instâncias ainda
// a_fazer. As finalizadas ficam no histórico, ligadas ao template inativo.
async function deactivateLink(
  supabase: ServerClient,
  templateId: string
): Promise<string | null> {
  const { error } = await supabase
    .from("task_templates")
    .update({ active: false })
    .eq("id", templateId);
  if (error) return error.message;

  const { error: delErr } = await supabase
    .from("task_instances")
    .delete()
    .eq("template_id", templateId)
    .eq("status", "a_fazer");
  return delErr?.message ?? null;
}

// Troca o responsável de um vínculo existente e propaga (sync_template_instances)
// para as instâncias ainda a_fazer.
async function retargetLink(
  supabase: ServerClient,
  templateId: string,
  collaboratorId: string
): Promise<string | null> {
  const { error } = await supabase
    .from("task_templates")
    .update({ collaborator_id: collaboratorId })
    .eq("id", templateId);
  if (error) return error.message;

  const { error: syncErr } = await supabase.rpc("sync_template_instances", {
    p_template: templateId,
  });
  return syncErr?.message ?? null;
}

// Cria o task_template do vínculo a partir do molde da padrão. A instância de
// HOJE nasce no banco, por triggers AFTER INSERT (única: trg_unique_template;
// diária: generate_template_today, só se hoje for dia marcado e dentro do
// horário-limite) — mesma regra de aparição no dia já existente.
async function createLink(
  supabase: ServerClient,
  userId: string,
  standardId: string,
  companyId: string,
  collaboratorId: string,
  std: StandardMold
): Promise<string | null> {
  const row: TablesInsert<"task_templates"> = {
    company_id: companyId,
    collaborator_id: collaboratorId,
    created_by: userId,
    standard_task_id: standardId,
    title: std.title,
    description: std.description,
    instructions: std.instructions,
    kind: std.kind,
    weekdays: std.kind === "diaria" ? std.weekdays ?? [] : [],
    due_time: std.due_time,
    start_date: todayISO(),
  };
  const { error } = await supabase.from("task_templates").insert(row);
  return error?.message ?? null;
}

export type CompanyStandardAssignment = {
  standardId: string;
  collaboratorId: string;
};

// Direção 2 — sincroniza quais tarefas padrão UMA empresa usa. Cria os vínculos
// novos, atualiza o responsável dos que continuam e desativa os que saíram.
export async function applyCompanyStandards(
  supabase: ServerClient,
  userId: string,
  companyId: string,
  assignments: CompanyStandardAssignment[]
): Promise<string | null> {
  const { data: existingData, error } = await supabase
    .from("task_templates")
    .select("id, standard_task_id, active, collaborator_id")
    .eq("company_id", companyId)
    .not("standard_task_id", "is", null);
  if (error) return error.message;

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

  const desired = new Map<string, CompanyStandardAssignment>();
  for (const a of assignments) {
    if (a.standardId && a.collaboratorId) desired.set(a.standardId, a);
  }

  // (a) Desativar os que saíram da seleção.
  for (const [standardId, tmpl] of Array.from(activeByStandard.entries())) {
    if (desired.has(standardId)) continue;
    const e = await deactivateLink(supabase, tmpl.id);
    if (e) return e;
  }

  // Moldes das padrões que precisamos criar do zero.
  const toCreate = Array.from(desired.values()).filter(
    (a) => !activeByStandard.has(a.standardId)
  );
  const moldsResult = await fetchMolds(
    supabase,
    toCreate.map((a) => a.standardId)
  );
  if ("error" in moldsResult) return moldsResult.error;

  // (b) Criar / (c) atualizar responsável dos que continuam.
  for (const [standardId, a] of Array.from(desired.entries())) {
    const active = activeByStandard.get(standardId);
    if (active) {
      if (active.collaborator_id !== a.collaboratorId) {
        const e = await retargetLink(supabase, active.id, a.collaboratorId);
        if (e) return e;
      }
      continue;
    }
    const std = moldsResult.molds.get(standardId);
    if (!std) return "Tarefa padrão não encontrada.";
    const e = await createLink(
      supabase,
      userId,
      standardId,
      companyId,
      a.collaboratorId,
      std
    );
    if (e) return e;
  }

  return null;
}

export type StandardCompanyAssignment = {
  companyId: string;
  collaboratorId: string;
};

// Direção 1 — sincroniza em quais empresas UMA tarefa padrão está atribuída.
// Espelho de applyCompanyStandards, iterando empresas para uma padrão fixa.
export async function applyStandardCompanies(
  supabase: ServerClient,
  userId: string,
  standardId: string,
  assignments: StandardCompanyAssignment[]
): Promise<string | null> {
  const { data: existingData, error } = await supabase
    .from("task_templates")
    .select("id, company_id, active, collaborator_id")
    .eq("standard_task_id", standardId);
  if (error) return error.message;

  const activeByCompany = new Map<
    string,
    { id: string; collaborator_id: string }
  >();
  for (const t of existingData ?? []) {
    if (t.active) {
      activeByCompany.set(t.company_id, {
        id: t.id,
        collaborator_id: t.collaborator_id,
      });
    }
  }

  const desired = new Map<string, StandardCompanyAssignment>();
  for (const a of assignments) {
    if (a.companyId && a.collaboratorId) desired.set(a.companyId, a);
  }

  // (a) Desativar as empresas que saíram da seleção.
  for (const [companyId, tmpl] of Array.from(activeByCompany.entries())) {
    if (desired.has(companyId)) continue;
    const e = await deactivateLink(supabase, tmpl.id);
    if (e) return e;
  }

  // O molde é o mesmo para todas as empresas (uma padrão só). Busca uma vez.
  const needCreate = Array.from(desired.keys()).some(
    (companyId) => !activeByCompany.has(companyId)
  );
  let mold: StandardMold | null = null;
  if (needCreate) {
    const moldsResult = await fetchMolds(supabase, [standardId]);
    if ("error" in moldsResult) return moldsResult.error;
    mold = moldsResult.molds.get(standardId) ?? null;
    if (!mold) return "Tarefa padrão não encontrada.";
  }

  // (b) Criar / (c) atualizar responsável das que continuam.
  for (const [companyId, a] of Array.from(desired.entries())) {
    const active = activeByCompany.get(companyId);
    if (active) {
      if (active.collaborator_id !== a.collaboratorId) {
        const e = await retargetLink(supabase, active.id, a.collaboratorId);
        if (e) return e;
      }
      continue;
    }
    const e = await createLink(
      supabase,
      userId,
      standardId,
      companyId,
      a.collaboratorId,
      mold as StandardMold
    );
    if (e) return e;
  }

  return null;
}
