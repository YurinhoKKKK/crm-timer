"use server";

import { createClient } from "@/lib/supabase-server";
import { loadCompanyLabels, type Label } from "@/lib/labels";
import {
  loadListingByTemplate,
  loadListingResults,
  type ListingDetails,
  type ListingResultView,
} from "@/lib/listing";
import {
  resolvePeople,
  describeInstanceCreator,
  type CreatorInfo,
} from "@/lib/creator";
import type { TaskKind, TaskStatus, TemplateType } from "@/lib/types";

// Detalhe COMPLETO de uma tarefa (instância) para o painel unificado
// (TaskDetailSheet): o que a tarefa é, quem faz, quem criou — e, se feita,
// o que foi entregue (resumo da finalização, WhatsApp, tempo, ajustes,
// listagens). Uma única server action reutilizada por TODAS as listas do
// sistema; a RLS (ti_select + políticas das tabelas satélites) escopa o que
// cada cargo pode abrir — quem não pode ver a tarefa recebe "não encontrada".

type Joined<T> = T | T[] | null;
function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export type TaskDetailAdjustment = {
  oldSeconds: number;
  newSeconds: number;
  reason: string | null;
  at: string;
  by: string;
  byAvatarUrl: string | null;
};

// Ação do rodapé do painel: leva à rota de edição/execução que JÁ existe para
// o cargo. Só aparece em tarefa aberta (feitas são leitura pura).
export type TaskDetailAction = {
  href: string;
  label: string;
  primary: boolean;
};

export type TaskDetail = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  finished_at: string | null;
  description: string | null;
  instructions: string | null;
  totalSeconds: number;
  companyId: string;
  companyName: string;
  collaboratorName: string;
  collaboratorAvatarUrl: string | null;
  kindLabel: string | null; // Única | Diária | Listagem de marcas
  labels: Label[]; // etiquetas herdadas da empresa
  creator: CreatorInfo;
  adjustments: TaskDetailAdjustment[]; // mais recente primeiro
  completionNote: string | null;
  noteSentWhatsapp: boolean;
  listing: ListingDetails | null;
  listingResults: ListingResultView[];
  actions: TaskDetailAction[];
  // Passo 25.1 — controle "ocultar do cliente": estado atual e se o painel
  // deve mostrar o toggle (tarefa elegível ao feed + cargo admin/consultor).
  clientHidden: boolean;
  canToggleClientHidden: boolean;
};

type InstanceRow = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: TaskStatus;
  due_at: string | null;
  task_date: string;
  created_at: string;
  finished_at: string | null;
  total_seconds: number;
  completion_note: string | null;
  note_sent_whatsapp: boolean;
  client_hidden: boolean;
  company_id: string;
  collaborator_id: string;
  template_id: string | null;
  company: Joined<{ name: string }>;
  template: Joined<{
    kind: TaskKind;
    template_type: TemplateType;
    created_by: string | null;
    created_at: string | null;
    standard_task_id: string | null;
  }>;
};

type AdjustmentRow = {
  old_seconds: number;
  new_seconds: number;
  reason: string | null;
  created_at: string;
  adjusted_by: string;
};

export async function getTaskDetail(
  taskId: string
): Promise<{ error: string | null; detail?: TaskDetail }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const [{ data: taskData, error: taskError }, { data: profileData }] =
    await Promise.all([
      supabase
        .from("task_instances")
        .select(
          "id, title, description, instructions, status, due_at, task_date, created_at, finished_at, total_seconds, completion_note, note_sent_whatsapp, client_hidden, company_id, collaborator_id, template_id, company:companies!task_instances_company_id_fkey(name), template:task_templates!task_instances_template_id_fkey(kind, template_type, created_by, created_at, standard_task_id)"
        )
        .eq("id", taskId)
        .maybeSingle(),
      supabase.from("profiles").select("role").eq("id", user.id).single(),
    ]);

  if (taskError) return { error: taskError.message };
  const task = taskData as InstanceRow | null;
  if (!task) return { error: "Tarefa não encontrada (ou sem acesso a ela)." };

  const role = (profileData as { role: string } | null)?.role ?? "";
  const template = first(task.template);
  const finished = task.status === "finalizada";

  // Satélites em paralelo. Cada leitura tem a própria RLS (ta_select,
  // lb_select, lr_select) alinhada à visibilidade da tarefa.
  const [labels, adjustmentsRes, listing, listingResults] = await Promise.all([
    loadCompanyLabels(supabase, task.company_id),
    supabase
      .from("time_adjustments")
      .select("old_seconds, new_seconds, reason, created_at, adjusted_by")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false }),
    task.template_id
      ? loadListingByTemplate(supabase, task.template_id)
      : Promise.resolve(null),
    finished && task.template_id
      ? loadListingResults(supabase, task.id)
      : Promise.resolve([] as ListingResultView[]),
  ]);

  const adjustmentRows = (adjustmentsRes.data as AdjustmentRow[]) ?? [];

  // Nome+foto (responsável, criador e quem ajustou) via display_profiles —
  // legível por qualquer cargo, em uma única chamada em lote.
  const people = await resolvePeople(supabase, [
    task.collaborator_id,
    template?.created_by,
    ...adjustmentRows.map((a) => a.adjusted_by),
  ]);

  const collaborator = people.get(task.collaborator_id);
  const creator = describeInstanceCreator(template, task.created_at, people);

  const adjustments: TaskDetailAdjustment[] = adjustmentRows.map((a) => ({
    oldSeconds: a.old_seconds,
    newSeconds: a.new_seconds,
    reason: a.reason,
    at: a.created_at,
    by: people.get(a.adjusted_by)?.name ?? "admin",
    byAvatarUrl: people.get(a.adjusted_by)?.avatarUrl ?? null,
  }));

  const kindLabel = !template
    ? null
    : template.template_type === "listagem"
      ? "Listagem de marcas"
      : template.kind === "diaria"
        ? "Diária"
        : "Única";

  // Regras de ação: feitas (finalizada/cancelada) abrem em leitura pura; nas
  // abertas, cada cargo ganha a rota de edição/execução que já existe.
  const open = task.status === "a_fazer" || task.status === "iniciada";
  const actions: TaskDetailAction[] = [];
  if (open) {
    if (task.collaborator_id === user.id) {
      // Executor (colaborador — ou admin/consultor autoatribuído): timer.
      actions.push({
        href: `/colaborador/${task.company_id}/${task.id}`,
        label: "Abrir tarefa (executar)",
        primary: true,
      });
    }
    if (role === "consultor") {
      actions.push({
        href: `/consultor/${task.company_id}/${task.id}`,
        label: "Editar tarefa",
        primary: actions.length === 0,
      });
    } else if (role === "admin" && task.template_id) {
      actions.push({
        href: `/admin/tarefas/${task.template_id}`,
        label: "Editar tarefa",
        primary: actions.length === 0,
      });
    }
  }

  // Elegível ao feed "Andamento" do portal (passo 25.1): única comum, fora
  // do catálogo de padrão e não cancelada (cancelada nunca entra no feed).
  // O toggle só aparece para admin/consultor — se um consultor consegue LER
  // a tarefa, a ti_select garante que a empresa é dele; colaborador não vê
  // o controle (e o gatilho guard_client_hidden barra no banco de todo modo).
  const feedEligible =
    !!template &&
    template.kind === "unica" &&
    template.template_type === "padrao" &&
    !template.standard_task_id &&
    task.status !== "cancelada";
  const canToggleClientHidden =
    feedEligible && (role === "admin" || role === "consultor");

  return {
    error: null,
    detail: {
      id: task.id,
      title: task.title,
      status: task.status,
      due_at: task.due_at,
      task_date: task.task_date,
      finished_at: task.finished_at,
      description: task.description,
      instructions: task.instructions,
      totalSeconds: task.total_seconds,
      companyId: task.company_id,
      companyName: first(task.company)?.name ?? "(empresa removida)",
      collaboratorName: collaborator?.name ?? "(sem responsável)",
      collaboratorAvatarUrl: collaborator?.avatarUrl ?? null,
      kindLabel,
      labels,
      creator,
      adjustments,
      completionNote: task.completion_note,
      noteSentWhatsapp: task.note_sent_whatsapp,
      listing,
      listingResults,
      actions,
      clientHidden: task.client_hidden,
      canToggleClientHidden,
    },
  };
}

// Passo 25.1 — oculta/mostra a tarefa no feed "Andamento" do portal do
// cliente. UPDATE direto com a proteção no banco: a RLS escopa a linha
// (admin/consultor da empresa) e o gatilho guard_client_hidden garante que
// SÓ esses cargos mudam a coluna (colaborador é barrado mesmo sendo dono da
// tarefa; o portal do cliente nem tem caminho de escrita).
export async function setTaskClientHidden(
  taskId: string,
  hidden: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase
    .from("task_instances")
    .update({ client_hidden: hidden })
    .eq("id", taskId)
    .select("id");

  if (error) return { error: "Sem permissão para alterar a visibilidade." };
  if (!data || data.length === 0)
    return { error: "Tarefa não encontrada (ou sem acesso a ela)." };
  return { error: null };
}
