import Link from "next/link";
import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/colaborador"
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← Minhas empresas
            </Link>
            <h1 className="mt-1 truncate text-2xl font-semibold text-gunmetal">
              {company.name}
            </h1>
          </div>
          <LogoutButton />
        </header>

        <section className="mb-6 rounded-xl border border-platinum bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center justify-between text-sm text-gunmetal/60">
            <span>Progresso geral</span>
            <span>
              {done} de {total} concluída{total === 1 ? "" : "s"} · {percent}%
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-platinum"
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
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Erro ao carregar tarefas: {error.message}
          </div>
        ) : (
          <TaskList companyId={company.id} tasks={tasks} />
        )}
      </div>
    </main>
  );
}
