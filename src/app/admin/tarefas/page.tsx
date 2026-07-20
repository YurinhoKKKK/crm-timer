import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskKind, TemplateType } from "@/lib/types";
import NewTaskForm from "./NewTaskForm";
import TaskTemplateList, { type TemplateItem } from "./TaskTemplateList";
import TarefasTabs from "./TarefasTabs";
import NewStandardTaskForm from "./NewStandardTaskForm";
import StandardTaskList, { type StandardItem } from "./StandardTaskList";
import { withSelf } from "@/lib/people";
import { loadAllLabelsByCompany, type Label } from "@/lib/labels";
import { avatarUrl } from "@/lib/avatar";
import { perfRoute } from "@/lib/perf";

type Option = { id: string; name: string };
type PersonOption = { id: string; full_name: string; email: string };

type TemplateRow = {
  id: string;
  title: string;
  kind: TaskKind;
  template_type: TemplateType;
  due_time: string | null;
  weekdays: number[] | null;
  start_date: string;
  active: boolean;
  created_at: string;
  company_id: string;
  collaborator_id: string;
  company: { name: string } | { name: string }[] | null;
  collaborator:
    | { full_name: string; email: string; avatar_path: string | null }
    | { full_name: string; email: string; avatar_path: string | null }[]
    | null;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function TarefasPage() {
  const { supabase, profile } = await guardRole(["admin"]);

  const perf = perfRoute("/admin/tarefas");
  const [
    { data: companiesData },
    { data: collaboratorsData },
    { data: templatesData, error: templatesError },
    { data: standardData, error: standardError },
    { data: usageData },
    labelsMap,
  ] = await Promise.all([
    perf.timed(
      "companies",
      supabase.from("companies").select("id, name").order("name", { ascending: true })
    ),
    perf.timed(
      "profiles (seletor de responsável)",
      supabase
        .from("profiles")
        .select("id, full_name, email")
        // Admins também podem ser responsáveis de tarefas.
        .in("role", ["colaborador", "admin"])
        .order("full_name", { ascending: true })
    ),
    perf.timed(
      "task_templates (lista, sem limit, join companies+profiles)",
      supabase
        .from("task_templates")
        .select(
          "id, title, kind, template_type, due_time, weekdays, start_date, active, created_at, company_id, collaborator_id, company:companies!task_templates_company_id_fkey(name), collaborator:profiles!task_templates_collaborator_id_fkey(full_name, email, avatar_path)"
        )
        .order("created_at", { ascending: false })
    ),
    // Catálogo de tarefas padrão (Passo 15).
    perf.timed(
      "standard_tasks (catálogo)",
      supabase
        .from("standard_tasks")
        .select("id, title, description, instructions, kind, due_time, weekdays")
        .order("created_at", { ascending: false })
    ),
    // Templates ativos ligados a padrões: contam o uso e, agora, dizem em quais
    // empresas (com qual responsável) cada padrão está atribuída (Direção 1).
    perf.timed(
      "task_templates (uso das padrões)",
      supabase
        .from("task_templates")
        .select("standard_task_id, company_id, collaborator_id")
        .eq("active", true)
        .not("standard_task_id", "is", null)
    ),
    // Etiquetas herdadas por empresa (exibidas em cada tarefa da lista). Sem
    // filtro por id, entra nesta mesma onda em vez de esperar os templates.
    perf.timed("company_labels (paralela)", loadAllLabelsByCompany(supabase)),
  ]);

  const companies = (companiesData as Option[]) ?? [];
  // O admin também pode se atribuir como responsável (Passo 14).
  const collaborators = withSelf(
    (collaboratorsData as PersonOption[]) ?? [],
    profile
  );
  const templateRows = (templatesData as TemplateRow[]) ?? [];

  const templates: TemplateItem[] = templateRows.map((t) => {
    const company = first(t.company);
    const collaborator = first(t.collaborator);
    return {
      id: t.id,
      title: t.title,
      kind: t.kind,
      templateType: t.template_type,
      due_time: t.due_time,
      weekdays: t.weekdays,
      start_date: t.start_date,
      active: t.active,
      companyId: t.company_id,
      collaboratorId: t.collaborator_id,
      companyName: company?.name ?? "(empresa removida)",
      collaboratorName:
        collaborator?.full_name || collaborator?.email || "(colaborador removido)",
      collaboratorAvatarUrl: avatarUrl(collaborator?.avatar_path),
    };
  });

  const canCreate = companies.length > 0 && collaborators.length > 0;

  perf.done();
  const labelsByCompany = Object.fromEntries(labelsMap) as Record<
    string,
    Label[]
  >;

  // Uso por padrão: contagem + em quais empresas está atribuída e com quem
  // (para o seletor de empresas na edição da padrão — Direção 1).
  const usageByStandard = new Map<string, number>();
  const linksByStandard = new Map<
    string,
    { companyId: string; collaboratorId: string }[]
  >();
  for (const row of (usageData as {
    standard_task_id: string | null;
    company_id: string;
    collaborator_id: string;
  }[]) ?? []) {
    if (!row.standard_task_id) continue;
    usageByStandard.set(
      row.standard_task_id,
      (usageByStandard.get(row.standard_task_id) ?? 0) + 1
    );
    const list = linksByStandard.get(row.standard_task_id) ?? [];
    list.push({ companyId: row.company_id, collaboratorId: row.collaborator_id });
    linksByStandard.set(row.standard_task_id, list);
  }

  const standardItems: StandardItem[] = (
    (standardData as Omit<StandardItem, "usageCount" | "assignments">[]) ?? []
  ).map((s) => ({
    ...s,
    usageCount: usageByStandard.get(s.id) ?? 0,
    assignments: linksByStandard.get(s.id) ?? [],
  }));

  const companyOptions = companies.map((c) => ({ id: c.id, name: c.name }));

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Cadastro de tarefas"
      subtitle="Crie tarefas únicas ou diárias. Elas aparecem automaticamente para os colaboradores."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      <TarefasTabs
        normal={
          <>
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
                labelsByCompany={labelsByCompany}
              />
            )}
          </>
        }
        standard={
          <>
            <p className="mb-4 text-sm text-fg-muted">
              Moldes reutilizáveis. Escolha as empresas que usam a padrão aqui ou
              no cadastro de cada empresa — editar a padrão atualiza as tarefas em
              aberto de todas as empresas que a usam.
            </p>

            <NewStandardTaskForm
              companies={companyOptions}
              collaborators={collaborators}
            />

            <h2 className="mb-3 mt-2 text-sm font-medium text-fg-muted">
              Catálogo de tarefas padrão
            </h2>

            {standardError ? (
              <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                Erro ao carregar tarefas padrão: {standardError.message}
              </div>
            ) : (
              <StandardTaskList
                items={standardItems}
                companies={companyOptions}
                collaborators={collaborators}
              />
            )}
          </>
        }
      />
    </AppShell>
  );
}
