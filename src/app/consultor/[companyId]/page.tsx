import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";
import { withSelf } from "@/lib/people";
import ConsultorTaskList, {
  type ConsultorTaskItem,
} from "./ConsultorTaskList";

type CompanyRow = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

type InstanceRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  created_at: string;
  collaborator:
    | { full_name: string; email: string }
    | { full_name: string; email: string }[]
    | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function ConsultorEmpresaPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { companyId } = params;
  const { supabase, profile } = await guardRole(["consultor"]);

  const [{ data: companyData }, { data: tasksData, error }, { data: collaboratorsData }] =
    await Promise.all([
      // RLS só devolve a empresa se ela for atribuída a este consultor.
      supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
      supabase
        .from("task_instances")
        .select(
          "id, title, status, due_at, total_seconds, created_at, collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email)"
        )
        .eq("company_id", companyId),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "colaborador")
        .order("full_name", { ascending: true }),
    ]);

  const company = companyData as CompanyRow | null;
  if (!company) notFound();

  // O consultor pode se atribuir como responsável nesta empresa (Passo 14).
  const collaborators = withSelf(
    (collaboratorsData as PersonOption[]) ?? [],
    profile
  );

  const rows = (tasksData as InstanceRow[]) ?? [];
  const tasks: ConsultorTaskItem[] = rows.map((r) => {
    const collab = first(r.collaborator);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_at: r.due_at,
      total_seconds: r.total_seconds,
      created_at: r.created_at,
      collaboratorName:
        collab?.full_name || collab?.email || "(colaborador removido)",
    };
  });

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "finalizada").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title={company.name}
      back={{ href: "/consultor", label: "Painel" }}
    >
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-2 flex items-center justify-between text-sm text-fg-muted">
          <span className="font-medium text-fg">Progresso geral</span>
          <span className="font-mono tabular-nums">
            {done} de {total} concluída{total === 1 ? "" : "s"} · {percent}%
          </span>
        </div>
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-risd transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </section>

      {collaborators.length > 0 && (
        <NewTaskForm
          companies={[{ id: company.id, name: company.name }]}
          collaborators={collaborators}
          lockedCompany={{ id: company.id, name: company.name }}
        />
      )}

      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error.message}
        </div>
      ) : (
        <ConsultorTaskList companyId={company.id} tasks={tasks} />
      )}
    </AppShell>
  );
}
