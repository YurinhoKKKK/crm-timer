import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import LabelChips from "@/components/LabelChips";
import CompanyNotes from "@/components/company-central/CompanyNotes";
import { loadCompanyLabels } from "@/lib/labels";
import { loadCompanyNotes } from "@/lib/notes";
import TaskList, { type TaskItem } from "./TaskList";

type CompanyRow = { id: string; name: string };

export default async function ColaboradorEmpresaPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { companyId } = params;
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);

  // Tarefas em duas leituras (abertas + fechadas recentes, com teto): as
  // fechadas viram GRUPOS por tarefa na lista. O progresso e as contagens dos
  // grupos vêm do banco (count exato + RPC task_group_stats), não do que foi
  // carregado.
  const CAP = 300;
  const TASK_SELECT =
    "id, title, status, due_at, task_date, template_id, total_seconds, created_at";
  const scoped = () =>
    supabase
      .from("task_instances")
      .select(TASK_SELECT)
      .eq("collaborator_id", profile.id)
      .eq("company_id", companyId);

  const [
    { data: companyData },
    { data: openData, error: openError },
    { data: closedData, error: closedError },
    { data: statsData },
    { count: totalCount },
    { count: doneCount },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
    scoped()
      .in("status", ["a_fazer", "iniciada"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(CAP),
    scoped()
      .in("status", ["finalizada", "cancelada"])
      .order("task_date", { ascending: false })
      .limit(CAP),
    supabase.rpc("task_group_stats", {
      p_company_id: companyId,
      p_collaborator_id: profile.id,
    }),
    supabase
      .from("task_instances")
      .select("id", { count: "exact", head: true })
      .eq("collaborator_id", profile.id)
      .eq("company_id", companyId),
    supabase
      .from("task_instances")
      .select("id", { count: "exact", head: true })
      .eq("collaborator_id", profile.id)
      .eq("company_id", companyId)
      .eq("status", "finalizada"),
  ]);

  const error = openError ?? closedError;
  const company = companyData as CompanyRow | null;
  if (!company) notFound();

  const [labels, notes] = await Promise.all([
    loadCompanyLabels(supabase, companyId),
    loadCompanyNotes(supabase, companyId),
  ]);

  type TaskRow = Omit<TaskItem, "templateId"> & { template_id: string | null };
  const tasks: TaskItem[] = [
    ...((openData as TaskRow[]) ?? []),
    ...((closedData as TaskRow[]) ?? []),
  ].map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    due_at: r.due_at,
    task_date: r.task_date,
    templateId: r.template_id,
    total_seconds: r.total_seconds,
    created_at: r.created_at,
  }));
  const total = totalCount ?? tasks.length;
  const done =
    doneCount ??
    tasks.filter((t) => (t.status as TaskStatus) === "finalizada").length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title={company.name}
      back={{ href: "/colaborador", label: "Minhas empresas" }}
    >
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        {labels.length > 0 && <LabelChips labels={labels} className="mb-4" />}
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
        <TaskList
          companyId={company.id}
          tasks={tasks}
          labels={labels}
          groupStats={statsData ?? []}
          totalCount={total}
        />
      )}

      {/* Anotações da empresa (passo 24): o colaborador lê todas e cria as
          suas; edita/exclui só as próprias (RLS cn_*). */}
      <section className="mt-8">
        <h2 className="mb-4 text-base font-semibold text-fg">Anotações</h2>
        <CompanyNotes
          companyId={company.id}
          userId={profile.id}
          isAdmin={profile.role === "admin"}
          notes={notes}
        />
      </section>
    </AppShell>
  );
}
