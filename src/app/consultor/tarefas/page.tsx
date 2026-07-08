import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus, TaskKind } from "@/lib/types";
import TaskInstanceList, {
  type TaskInstanceItem,
} from "@/components/TaskInstanceList";
import type { SelectOption } from "@/components/ListControls";
import { loadLabelsByCompany, type Label } from "@/lib/labels";

type Joined<T> = T | T[] | null;

type InstanceRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  company_id: string;
  collaborator_id: string;
  company: Joined<{ name: string }>;
  collaborator: Joined<{ full_name: string; email: string }>;
  template: Joined<{ kind: TaskKind }>;
};

function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// Teto de itens carregados por vez (Passo 18). Esta lista não tem filtro de
// período, então cresce sem limite; buscamos CAP+1 para saber se há mais.
const CAP = 300;

export default async function ConsultorTarefasPage() {
  const { supabase, profile } = await guardRole(["consultor"]);

  // A RLS (ti_select) já limita às instâncias das empresas atribuídas ao
  // consultor — de todos os colaboradores dessas empresas.
  const { data, error } = await supabase
    .from("task_instances")
    .select(
      "id, title, status, due_at, total_seconds, company_id, collaborator_id, company:companies!task_instances_company_id_fkey(name), collaborator:profiles!task_instances_collaborator_id_fkey(full_name, email), template:task_templates!task_instances_template_id_fkey(kind)"
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(CAP + 1);

  const allRows = (data as InstanceRow[]) ?? [];
  const truncated = allRows.length > CAP;
  const rows = truncated ? allRows.slice(0, CAP) : allRows;

  const items: TaskInstanceItem[] = rows.map((r) => {
    const company = first(r.company);
    const collaborator = first(r.collaborator);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_at: r.due_at,
      total_seconds: r.total_seconds,
      kind: first(r.template)?.kind ?? null,
      companyId: r.company_id,
      companyName: company?.name ?? "(empresa removida)",
      collaboratorId: r.collaborator_id,
      collaboratorName:
        collaborator?.full_name || collaborator?.email || "(colaborador removido)",
    };
  });

  // Opções de filtro derivadas das próprias tarefas (apenas o que aparece).
  const companies = dedupe(items.map((i) => [i.companyId, i.companyName]));
  const collaborators = dedupe(
    items.map((i) => [i.collaboratorId, i.collaboratorName])
  );

  // Etiquetas herdadas por empresa (uma consulta em lote para toda a lista).
  const labelsMap = await loadLabelsByCompany(
    supabase,
    items.map((i) => i.companyId)
  );
  const labelsByCompany = Object.fromEntries(labelsMap) as Record<
    string,
    Label[]
  >;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title="Tarefas"
      subtitle="Todas as tarefas das suas empresas."
      back={{ href: "/consultor", label: "Painel" }}
    >
      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error.message}
        </div>
      ) : (
        <TaskInstanceList
          items={items}
          panel="consultor"
          companies={companies}
          collaborators={collaborators}
          truncated={truncated}
          labelsByCompany={labelsByCompany}
        />
      )}
    </AppShell>
  );
}

// Constrói opções de <select> únicas (por id) ordenadas por rótulo.
function dedupe(pairs: [string, string][]): SelectOption[] {
  const map = new Map<string, string>();
  for (const [value, label] of pairs) {
    if (!map.has(value)) map.set(value, label);
  }
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
