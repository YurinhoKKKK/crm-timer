import Link from "next/link";
import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
import type { TaskStatus } from "@/lib/types";
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

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  a_fazer: { label: "A fazer", className: "border border-platinum bg-paper text-gunmetal/70" },
  iniciada: { label: "Iniciada", className: "bg-brand-soft text-risd" },
  finalizada: { label: "Finalizada", className: "bg-green-100 text-green-700" },
  cancelada: { label: "Cancelada", className: "bg-platinum text-gunmetal/50" },
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0min";
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

export default async function ConsultorTarefaPage({
  params,
}: {
  params: { companyId: string; taskId: string };
}) {
  const { companyId, taskId } = params;
  const { supabase } = await guardRole(["consultor"]);

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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href={`/consultor/${companyId}`}
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← {companyName}
            </Link>
            <h1 className="mt-1 truncate text-2xl font-semibold text-gunmetal">
              {task.title}
            </h1>
          </div>
          <LogoutButton />
        </header>

        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-platinum bg-white p-4 shadow-sm">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
          >
            {meta.label}
          </span>
          <span className="text-sm text-gunmetal/60">
            Tempo gasto: {formatDuration(task.total_seconds)}
          </span>
          <span className="text-xs text-gunmetal/40">
            O status é definido pelo fluxo do timer do colaborador e não é
            editável aqui.
          </span>
        </section>

        <section className="rounded-xl border border-platinum bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-medium text-gunmetal">Editar tarefa</h2>
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
      </div>
    </main>
  );
}
