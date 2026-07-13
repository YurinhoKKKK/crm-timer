import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import CreatorMeta from "@/components/CreatorMeta";
import LabelChips from "@/components/LabelChips";
import ListingSummary from "@/components/ListingSummary";
import ListingResultsView from "@/components/ListingResultsView";
import { loadCompanyLabels } from "@/lib/labels";
import { loadListingByTemplate, loadListingResults } from "@/lib/listing";
import { resolvePeople, describeInstanceCreator } from "@/lib/creator";
import Person from "@/components/Person";
import { avatarUrl } from "@/lib/avatar";
import TaskInstanceEditor from "./TaskInstanceEditor";
import DeleteTaskButton from "@/app/admin/tarefas/[id]/DeleteTaskButton";

type PersonOption = {
  id: string;
  full_name: string;
  email: string;
  avatar_path?: string | null;
};

type InstanceRow = {
  id: string;
  company_id: string;
  collaborator_id: string;
  template_id: string | null;
  title: string;
  description: string | null;
  instructions: string | null;
  due_at: string | null;
  status: TaskStatus;
  total_seconds: number;
  created_at: string;
  company: { name: string } | { name: string }[] | null;
  template:
    | { created_by: string | null; created_at: string | null; standard_task_id: string | null }
    | { created_by: string | null; created_at: string | null; standard_task_id: string | null }[]
    | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function ConsultorTarefaPage({
  params,
}: {
  params: { companyId: string; taskId: string };
}) {
  const { companyId, taskId } = params;
  const { supabase, profile } = await guardRole(["consultor"]);

  const [{ data: taskData }, { data: collaboratorsData }] = await Promise.all([
    // RLS só devolve a tarefa se ela for de uma empresa atribuída ao consultor.
    supabase
      .from("task_instances")
      .select(
        "id, company_id, collaborator_id, template_id, title, description, instructions, due_at, status, total_seconds, created_at, company:companies!task_instances_company_id_fkey(name), template:task_templates!task_instances_template_id_fkey(created_by, created_at, standard_task_id)"
      )
      .eq("id", taskId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, email, avatar_path")
      // Admins também podem ser responsáveis de tarefas.
      .in("role", ["colaborador", "admin"])
      .order("full_name", { ascending: true }),
  ]);

  const task = taskData as InstanceRow | null;
  if (!task || task.company_id !== companyId) notFound();

  const collaborators = (collaboratorsData as PersonOption[]) ?? [];
  const meta = STATUS_META[task.status];
  const companyName = first(task.company)?.name ?? "Empresa";

  // O consultor só pode excluir tarefas (moldes) que ele mesmo criou. Excluir
  // remove o molde e todas as ocorrências; somamos o tempo de todas para o
  // aviso. A RLS (tt_delete) reforça a permissão no banco.
  const template = first(task.template);
  const canDelete = !!task.template_id && template?.created_by === profile.id;

  // Transparência: quem criou a tarefa e quando (e se esta ocorrência veio da
  // recorrência). Nome+foto vêm de display_profiles (legível a todos os cargos).
  const people = await resolvePeople(supabase, [template?.created_by]);
  const creator = describeInstanceCreator(template, task.created_at, people);

  // Responsável atual pela execução (para exibir com avatar no cabeçalho).
  const responsible = collaborators.find((c) => c.id === task.collaborator_id);

  // Etiquetas herdadas da empresa (exibidas no detalhe da tarefa).
  const labels = await loadCompanyLabels(supabase, task.company_id);

  // Detalhes da listagem de marcas (passo 22), se for esse o tipo da tarefa;
  // e os resultados (links/justificativas) se já finalizada (passo 22.1).
  const listing = task.template_id
    ? await loadListingByTemplate(supabase, task.template_id)
    : null;
  const listingResults =
    listing && task.status === "finalizada"
      ? await loadListingResults(supabase, task.id)
      : [];

  let deleteSeconds = 0;
  let deleteCount = 0;
  if (canDelete && task.template_id) {
    const { data: siblings } = await supabase
      .from("task_instances")
      .select("total_seconds")
      .eq("template_id", task.template_id);
    const rows = (siblings as { total_seconds: number }[]) ?? [];
    deleteSeconds = rows.reduce((sum, r) => sum + r.total_seconds, 0);
    deleteCount = rows.length;
  }

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title={task.title}
      back={{ href: `/consultor/${companyId}`, label: companyName }}
    >
      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        {labels.length > 0 && (
          <div className="w-full">
            <LabelChips labels={labels} />
          </div>
        )}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        {responsible && (
          <span className="flex items-center gap-1.5 text-sm text-fg-muted">
            Responsável:{" "}
            <Person
              name={responsible.full_name || responsible.email}
              avatarUrl={avatarUrl(responsible.avatar_path)}
              size={20}
              className="text-fg"
            />
          </span>
        )}
        <span className="text-sm text-fg-muted">
          Tempo gasto:{" "}
          <span className="font-mono tabular-nums text-fg">
            {formatDuration(task.total_seconds)}
          </span>
        </span>
        <span className="text-xs text-fg-subtle">
          O status é definido pelo fluxo do timer do colaborador e não é editável
          aqui.
        </span>
        <div className="w-full border-t border-line pt-3">
          <CreatorMeta
            label="Criada por"
            who={creator.who}
            whoAvatarUrl={creator.whoAvatarUrl}
            whenISO={creator.whenISO}
            fromStandard={creator.fromStandard}
            systemGenerated={creator.systemGenerated}
            hasOrigin={creator.hasOrigin}
          />
        </div>
      </section>

      {listing && <ListingSummary listing={listing} className="mb-6" />}

      {listingResults.length > 0 && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <ListingResultsView results={listingResults} />
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <h2 className="mb-4 font-semibold text-fg">Editar tarefa</h2>
        <TaskInstanceEditor
          taskId={task.id}
          companyId={companyId}
          initial={{
            title: task.title,
            description: task.description,
            instructions: task.instructions,
            due_at: task.due_at,
            collaborator_id: task.collaborator_id,
          }}
          collaborators={collaborators}
        />
      </section>

      {canDelete && (
        <section className="mt-6 rounded-2xl border border-red-300/60 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-500/10">
          <h2 className="font-semibold text-red-800 dark:text-red-300">
            Excluir tarefa
          </h2>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300/80">
            Remove a tarefa e todas as suas ocorrências (incluindo tempo
            registrado e histórico) de todos os painéis. Esta ação não pode ser
            desfeita.
          </p>
          <div className="mt-4">
            <DeleteTaskButton
              templateId={task.template_id!}
              title={task.title}
              totalSeconds={deleteSeconds}
              instanceCount={deleteCount}
              redirectTo={`/consultor/${companyId}`}
            />
          </div>
        </section>
      )}
    </AppShell>
  );
}
