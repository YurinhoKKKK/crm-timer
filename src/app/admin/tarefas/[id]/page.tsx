import Link from "next/link";
import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
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
  const { supabase } = await guardRole(["admin"]);

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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/admin/tarefas"
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← Tarefas
            </Link>
            <h1 className="mt-1 truncate text-2xl font-semibold text-gunmetal">
              {template.title}
            </h1>
          </div>
          <LogoutButton />
        </header>

        <section className="mb-6 rounded-xl border border-platinum bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-medium text-gunmetal">Dados da tarefa</h2>
          <TaskEditor
            template={template}
            companies={companies}
            collaborators={collaborators}
          />
          <p className="mt-4 text-xs text-gunmetal/40">
            Editar a tarefa vale para as próximas gerações. Instâncias já criadas
            (que o colaborador já vê) não são alteradas.
          </p>
        </section>

        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-medium text-red-800">Excluir tarefa</h2>
          <p className="mt-1 text-sm text-red-700">
            Remove o molde da tarefa. As instâncias já geradas permanecem para o
            colaborador, apenas desvinculadas deste molde. Esta ação não pode ser
            desfeita.
          </p>
          <div className="mt-4">
            <DeleteTaskButton templateId={template.id} title={template.title} />
          </div>
        </section>
      </div>
    </main>
  );
}
