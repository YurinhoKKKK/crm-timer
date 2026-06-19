import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
import type { TaskKind } from "@/lib/types";
import NewTaskForm from "./NewTaskForm";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type TemplateRow = {
  id: string;
  title: string;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[] | null;
  start_date: string;
  active: boolean;
  created_at: string;
  company: { name: string } | { name: string }[] | null;
  collaborator:
    | { full_name: string; email: string }
    | { full_name: string; email: string }[]
    | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function formatTime(time: string | null): string | null {
  if (!time) return null;
  return time.slice(0, 5); // HH:MM
}

function describeSchedule(t: TemplateRow): string {
  const time = formatTime(t.due_time);
  if (t.kind === "diaria") {
    const days = (t.weekdays ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join(", ");
    return `Diária · ${days || "sem dias"}${time ? ` · até ${time}` : ""}`;
  }
  const date = new Date(`${t.start_date}T00:00:00`).toLocaleDateString("pt-BR");
  return `Única · ${date}${time ? ` · até ${time}` : ""}`;
}

export default async function TarefasPage() {
  const { supabase } = await guardRole(["admin"]);

  const [{ data: companiesData }, { data: collaboratorsData }, { data: templatesData, error: templatesError }] =
    await Promise.all([
      supabase.from("companies").select("id, name").order("name", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "colaborador")
        .order("full_name", { ascending: true }),
      supabase
        .from("task_templates")
        .select(
          "id, title, kind, due_time, weekdays, start_date, active, created_at, company:companies!task_templates_company_id_fkey(name), collaborator:profiles!task_templates_collaborator_id_fkey(full_name, email)"
        )
        .order("created_at", { ascending: false }),
    ]);

  const companies = (companiesData as Option[]) ?? [];
  const collaborators = (collaboratorsData as PersonOption[]) ?? [];
  const templates = (templatesData as TemplateRow[]) ?? [];

  const canCreate = companies.length > 0 && collaborators.length > 0;

  return (
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/admin"
              className="rounded text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              ← Painel
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-gunmetal">
              Cadastro de tarefas
            </h1>
            <p className="text-sm text-gunmetal/60">
              Crie tarefas únicas ou diárias para os colaboradores. As tarefas
              aparecem automaticamente para eles.
            </p>
          </div>
          <LogoutButton />
        </header>

        {!canCreate && (
          <div className="mb-6 rounded-lg border border-risd/30 bg-brand-soft px-4 py-3 text-sm text-gunmetal">
            Para criar tarefas você precisa de pelo menos{" "}
            {companies.length === 0 && (
              <>
                uma{" "}
                <Link href="/admin/empresas" className="text-risd hover:underline">
                  empresa
                </Link>
              </>
            )}
            {companies.length === 0 && collaborators.length === 0 && " e "}
            {collaborators.length === 0 && (
              <>
                um{" "}
                <Link href="/admin/usuarios" className="text-risd hover:underline">
                  colaborador
                </Link>
              </>
            )}
            .
          </div>
        )}

        {canCreate && (
          <NewTaskForm companies={companies} collaborators={collaborators} />
        )}

        <h2 className="mb-3 mt-2 text-sm font-medium text-gunmetal/70">
          Tarefas cadastradas
        </h2>

        {templatesError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Erro ao carregar tarefas: {templatesError.message}
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-xl border border-platinum bg-white p-12 text-center text-gunmetal/50 shadow-sm">
            Nenhuma tarefa cadastrada ainda.
          </div>
        ) : (
          <ul className="space-y-3">
            {templates.map((t) => {
              const company = first(t.company);
              const collaborator = first(t.collaborator);
              return (
                <li key={t.id}>
                  <Link
                    href={`/admin/tarefas/${t.id}`}
                    className="group block rounded-xl border border-platinum bg-white p-4 shadow-sm transition hover:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gunmetal group-hover:text-risd">
                        {t.title}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.kind === "diaria"
                            ? "bg-brand-soft text-risd"
                            : "border border-platinum bg-paper text-gunmetal/70"
                        }`}
                      >
                        {t.kind === "diaria" ? "Diária" : "Única"}
                      </span>
                      {!t.active && (
                        <span className="rounded-full border border-platinum bg-paper px-2 py-0.5 text-xs text-gunmetal/40">
                          inativa
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gunmetal/60">
                      {company?.name ?? "(empresa removida)"} ·{" "}
                      {collaborator?.full_name || collaborator?.email || "(colaborador removido)"}
                    </p>
                    <p className="mt-1 text-xs text-gunmetal/40">
                      {describeSchedule(t)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
