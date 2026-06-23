import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import TaskList, { type TaskItem } from "./TaskList";

type CompanyRow = { id: string; name: string };

export default async function ColaboradorEmpresaPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { companyId } = params;
  const { supabase, profile } = await guardRole(["colaborador"]);

  const [{ data: companyData }, { data: tasksData, error }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
    supabase
      .from("task_instances")
      .select("id, title, status, due_at, total_seconds, created_at")
      .eq("collaborator_id", profile.id)
      .eq("company_id", companyId),
  ]);

  const company = companyData as CompanyRow | null;
  if (!company) notFound();

  const tasks = (tasksData as TaskItem[]) ?? [];
  const total = tasks.length;
  const done = tasks.filter((t) => (t.status as TaskStatus) === "finalizada").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "colaborador" }}
      title={company.name}
      back={{ href: "/colaborador", label: "Minhas empresas" }}
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

      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error.message}
        </div>
      ) : (
        <TaskList companyId={company.id} tasks={tasks} />
      )}
    </AppShell>
  );
}
