import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import Timer from "./Timer";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  completion_note: string | null;
  company_id: string;
  company: { name: string } | { name: string }[] | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function formatDue(due: string | null): string {
  if (!due) return "Sem prazo";
  return new Date(due).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TarefaPage({
  params,
}: {
  params: { companyId: string; taskId: string };
}) {
  const { companyId, taskId } = params;
  const { supabase, profile } = await guardRole(["colaborador"]);

  const { data: taskData } = await supabase
    .from("task_instances")
    .select(
      "id, title, description, instructions, status, due_at, total_seconds, completion_note, company_id, company:companies!task_instances_company_id_fkey(name)"
    )
    .eq("id", taskId)
    .eq("collaborator_id", profile.id)
    .maybeSingle();

  const task = taskData as TaskRow | null;
  if (!task) notFound();

  // Recupera um intervalo aberto (sem ended_at) para retomar o cronômetro.
  const { data: openEntry } = await supabase
    .from("time_entries")
    .select("started_at")
    .eq("task_id", taskId)
    .eq("collaborator_id", profile.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const company = first(task.company);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "colaborador", avatarUrl: profile.avatarUrl }}
      title={task.title}
      back={{
        href: `/colaborador/${companyId}`,
        label: company?.name ?? "Empresa",
      }}
    >
      <div className="mx-auto max-w-2xl">
        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Prazo
              </dt>
              <dd className="mt-0.5 text-fg">{formatDue(task.due_at)}</dd>
            </div>
            {task.description && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  Descrição
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-fg-muted">
                  {task.description}
                </dd>
              </div>
            )}
            {task.instructions && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  Instruções
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-fg-muted">
                  {task.instructions}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <Timer
          taskId={task.id}
          companyId={task.company_id}
          status={task.status}
          totalSeconds={task.total_seconds}
          openStartedAt={openEntry?.started_at ?? null}
          completionNote={task.completion_note}
        />
      </div>
    </AppShell>
  );
}
