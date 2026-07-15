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
  task_date: string;
  template_id: string | null;
  total_seconds: number;
  company_id: string;
  collaborator_id: string;
  company: Joined<{ name: string }>;
  template: Joined<{ kind: TaskKind }>;
};

function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// Teto de itens carregados por vez (Passo 18). Lista sem filtro de período,
// cresce sem limite; buscamos CAP+1 para saber se há mais. Abertas e fechadas
// têm tetos separados: as fechadas viram GRUPOS por tarefa (contagens via RPC).
const CAP = 300;

const INSTANCE_SELECT =
  "id, title, status, due_at, task_date, template_id, total_seconds, company_id, collaborator_id, company:companies!task_instances_company_id_fkey(name), template:task_templates!task_instances_template_id_fkey(kind)";

export default async function ColaboradorTarefasPage() {
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);

  // Escopo explícito ao próprio colaborador (a RLS ti_select já garante, mas
  // deixamos a query clara). Nunca vê tarefas de outros colaboradores.
  const [openRes, closedRes, statsRes] = await Promise.all([
    supabase
      .from("task_instances")
      .select(INSTANCE_SELECT)
      .eq("collaborator_id", profile.id)
      .in("status", ["a_fazer", "iniciada"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(CAP + 1),
    supabase
      .from("task_instances")
      .select(INSTANCE_SELECT)
      .eq("collaborator_id", profile.id)
      .in("status", ["finalizada", "cancelada"])
      .order("task_date", { ascending: false })
      .limit(CAP + 1),
    supabase.rpc("task_group_stats", { p_collaborator_id: profile.id }),
  ]);

  const error = openRes.error ?? closedRes.error;
  const openAll = (openRes.data as InstanceRow[]) ?? [];
  const closedAll = (closedRes.data as InstanceRow[]) ?? [];
  const truncated = openAll.length > CAP || closedAll.length > CAP;
  const rows = [...openAll.slice(0, CAP), ...closedAll.slice(0, CAP)];
  const groupStats = statsRes.data ?? [];

  const items: TaskInstanceItem[] = rows.map((r) => {
    const company = first(r.company);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      due_at: r.due_at,
      task_date: r.task_date,
      templateId: r.template_id,
      total_seconds: r.total_seconds,
      kind: first(r.template)?.kind ?? null,
      companyId: r.company_id,
      companyName: company?.name ?? "(empresa removida)",
      collaboratorId: r.collaborator_id,
      collaboratorName: profile.full_name,
    };
  });

  const companies = dedupe(items.map((i) => [i.companyId, i.companyName]));

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
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Minhas tarefas"
      subtitle="Todas as suas tarefas, de todas as empresas."
      back={{ href: "/colaborador", label: "Minhas empresas" }}
    >
      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error.message}
        </div>
      ) : (
        <TaskInstanceList
          items={items}
          panel="colaborador"
          companies={companies}
          truncated={truncated}
          labelsByCompany={labelsByCompany}
          groupStats={groupStats}
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
