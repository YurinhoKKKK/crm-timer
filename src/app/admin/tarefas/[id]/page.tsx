import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskTemplate } from "@/lib/types";
import TaskEditor from "./TaskEditor";
import DeleteTaskButton from "./DeleteTaskButton";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

export default async function TarefaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { supabase, profile } = await guardRole(["admin"]);

  const [{ data: templateData }, { data: companiesData }, { data: collaboratorsData }] =
    await Promise.all([
      supabase
        .from("task_templates")
        .select(
          "id, title, description, instructions, company_id, collaborator_id, kind, due_time, weekdays, start_date, end_date, active"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("companies").select("id, name").order("name", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "colaborador")
        .order("full_name", { ascending: true }),
    ]);

  const template = templateData as TaskTemplate | null;
  if (!template) notFound();

  const companies = (companiesData as Option[]) ?? [];
  const collaborators = (collaboratorsData as PersonOption[]) ?? [];

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin" }}
      title={template.title}
      back={{ href: "/admin/tarefas", label: "Tarefas" }}
    >
      <div className="mx-auto max-w-2xl">
        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-4 font-semibold text-fg">Dados da tarefa</h2>
          <TaskEditor
            template={template}
            companies={companies}
            collaborators={collaborators}
          />
          <p className="mt-4 text-xs text-fg-subtle">
            Editar a tarefa vale para as próximas gerações. Instâncias já criadas
            (que o colaborador já vê) não são alteradas.
          </p>
        </section>

        <section className="rounded-2xl border border-red-300/60 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-500/10">
          <h2 className="font-semibold text-red-800 dark:text-red-300">
            Excluir tarefa
          </h2>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300/80">
            Remove o molde da tarefa. As instâncias já geradas permanecem para o
            colaborador, apenas desvinculadas deste molde. Esta ação não pode ser
            desfeita.
          </p>
          <div className="mt-4">
            <DeleteTaskButton templateId={template.id} title={template.title} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
