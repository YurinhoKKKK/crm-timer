import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import TaskInstanceEditor from "./TaskInstanceEditor";

type PersonOption = { id: string; full_name: string; email: string };

type InstanceRow = {
  id: string;
  company_id: string;
  collaborator_id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  due_at: string | null;
  status: TaskStatus;
  total_seconds: number;
  company: { name: string } | { name: string }[] | null;
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
        "id, company_id, collaborator_id, title, description, instructions, due_at, status, total_seconds, company:companies!task_instances_company_id_fkey(name)"
      )
      .eq("id", taskId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "colaborador")
      .order("full_name", { ascending: true }),
  ]);

  const task = taskData as InstanceRow | null;
  if (!task || task.company_id !== companyId) notFound();

  const collaborators = (collaboratorsData as PersonOption[]) ?? [];
  const meta = STATUS_META[task.status];
  const companyName = first(task.company)?.name ?? "Empresa";

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor" }}
      title={task.title}
      back={{ href: `/consultor/${companyId}`, label: companyName }}
    >
      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
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
      </section>

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
    </AppShell>
  );
}
