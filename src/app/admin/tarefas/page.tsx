import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskKind } from "@/lib/types";
import NewTaskForm from "./NewTaskForm";
import TaskTemplateList, { type TemplateItem } from "./TaskTemplateList";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

type TemplateRow = {
  id: string;
  title: string;
  kind: TaskKind;
  due_time: string | null;
  weekdays: number[] | null;
  start_date: string;
  active: boolean;
  created_at: string;
  company_id: string;
  collaborator_id: string;
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

export default async function TarefasPage() {
  const { supabase, profile } = await guardRole(["admin"]);

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
          "id, title, kind, due_time, weekdays, start_date, active, created_at, company_id, collaborator_id, company:companies!task_templates_company_id_fkey(name), collaborator:profiles!task_templates_collaborator_id_fkey(full_name, email)"
        )
        .order("created_at", { ascending: false }),
    ]);

  const companies = (companiesData as Option[]) ?? [];
  const collaborators = (collaboratorsData as PersonOption[]) ?? [];
  const templateRows = (templatesData as TemplateRow[]) ?? [];

  const templates: TemplateItem[] = templateRows.map((t) => {
    const company = first(t.company);
    const collaborator = first(t.collaborator);
    return {
      id: t.id,
      title: t.title,
      kind: t.kind,
      due_time: t.due_time,
      weekdays: t.weekdays,
      start_date: t.start_date,
      active: t.active,
      companyId: t.company_id,
      collaboratorId: t.collaborator_id,
      companyName: company?.name ?? "(empresa removida)",
      collaboratorName:
        collaborator?.full_name || collaborator?.email || "(colaborador removido)",
    };
  });

  const canCreate = companies.length > 0 && collaborators.length > 0;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Cadastro de tarefas"
      subtitle="Crie tarefas únicas ou diárias. Elas aparecem automaticamente para os colaboradores."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      {!canCreate && (
        <div className="mb-6 rounded-xl border border-risd/30 bg-brand-tint px-4 py-3 text-sm text-fg">
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

      <h2 className="mb-3 mt-2 text-sm font-medium text-fg-muted">
        Tarefas cadastradas
      </h2>

      {templatesError ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {templatesError.message}
        </div>
      ) : (
        <TaskTemplateList
          templates={templates}
          companies={companies.map((c) => ({ value: c.id, label: c.name }))}
          collaborators={collaborators.map((p) => ({
            value: p.id,
            label: p.full_name || p.email,
          }))}
        />
      )}
    </AppShell>
  );
}
