import Link from "next/link";
import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href={`/colaborador/${companyId}`}
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← {company?.name ?? "Empresa"}
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-gunmetal">
              {task.title}
            </h1>
          </div>
          <LogoutButton />
        </header>

        <section className="mb-6 rounded-xl border border-platinum bg-white p-5 shadow-sm">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-medium text-gunmetal">Prazo</dt>
              <dd className="text-gunmetal/70">{formatDue(task.due_at)}</dd>
            </div>
            {task.description && (
              <div>
                <dt className="font-medium text-gunmetal">Descrição</dt>
                <dd className="whitespace-pre-wrap text-gunmetal/70">
                  {task.description}
                </dd>
              </div>
            )}
            {task.instructions && (
              <div>
                <dt className="font-medium text-gunmetal">Instruções</dt>
                <dd className="whitespace-pre-wrap text-gunmetal/70">
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
    </main>
  );
}
