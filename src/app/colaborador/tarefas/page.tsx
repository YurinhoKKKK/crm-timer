import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus, TaskKind } from "@/lib/types";
import TaskInstanceList, {
  type TaskInstanceItem,
} from "@/components/TaskInstanceList";
import type { SelectOption } from "@/components/ListControls";

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
  template: Joined<{ kind: TaskKind }>;
};

function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function ColaboradorTarefasPage() {
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);

  // Escopo explícito ao próprio colaborador (a RLS ti_select já garante, mas
  // deixamos a query clara). Nunca vê tarefas de outros colaboradores.
  const { data, error } = await supabase
    .from("task_instances")
    .select(
      "id, title, status, due_at, total_seconds, company_id, collaborator_id, company:companies!task_instances_company_id_fkey(name), template:task_templates!task_instances_template_id_fkey(kind)"
    )
    .eq("collaborator_id", profile.id)
    .order("due_at", { ascending: true, nullsFirst: false });

  const rows = (data as InstanceRow[]) ?? [];

  const items: TaskInstanceItem[] = rows.map((r) => {
    const company = first(r.company);
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
      collaboratorName: profile.full_name,
    };
  });

  const companies = dedupe(items.map((i) => [i.companyId, i.companyName]));

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
        <TaskInstanceList items={items} panel="colaborador" companies={companies} />
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
