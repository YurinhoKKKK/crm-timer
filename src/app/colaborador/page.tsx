import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import CompanySummaryGrid, {
  type CompanyCardItem,
} from "@/components/CompanySummaryGrid";
import { loadLabelsByCompany } from "@/lib/labels";
import { perfRoute } from "@/lib/perf";

type InstanceRow = {
  id: string;
  company_id: string;
  status: TaskStatus;
  due_at: string | null;
  company: { name: string } | { name: string }[] | null;
};

type CompanySummary = {
  id: string;
  name: string;
  total: number;
  done: number;
  pending: number;
  overdue: number;
  dueSoon: number;
};

function first<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function ColaboradorPage() {
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);

  const perf = perfRoute("/colaborador (Meu Trabalho)");
  const { data, error } = await perf.timed(
    "task_instances do usuário (join companies)",
    supabase
      .from("task_instances")
      .select(
        "id, company_id, status, due_at, company:companies!task_instances_company_id_fkey(name)"
      )
      .eq("collaborator_id", profile.id)
  );

  const rows = (data as InstanceRow[]) ?? [];

  const now = Date.now();
  const SOON_MS = 24 * 60 * 60 * 1000;

  // Agrupa as instâncias do colaborador por empresa.
  const byCompany = new Map<string, CompanySummary>();
  for (const r of rows) {
    const summary = byCompany.get(r.company_id) ?? {
      id: r.company_id,
      name: first(r.company)?.name ?? "(empresa)",
      total: 0,
      done: 0,
      pending: 0,
      overdue: 0,
      dueSoon: 0,
    };

    summary.total += 1;
    if (r.status === "finalizada") {
      summary.done += 1;
    } else if (r.status !== "cancelada") {
      summary.pending += 1;
      if (r.due_at) {
        const due = new Date(r.due_at).getTime();
        if (due < now) summary.overdue += 1;
        else if (due - now <= SOON_MS) summary.dueSoon += 1;
      }
    }

    byCompany.set(r.company_id, summary);
  }

  const companies = Array.from(byCompany.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );

  // Etiquetas herdadas da empresa (uma consulta em lote para todos os cards).
  // WATERFALL: depende dos company_id apurados acima.
  const labelsByCompany = await perf.timed(
    "company_labels (WATERFALL — 2ª onda)",
    loadLabelsByCompany(
      supabase,
      companies.map((c) => c.id)
    )
  );
  perf.done();

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Minhas empresas"
      subtitle={`Bem-vindo, ${profile.full_name}`}
    >
      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar suas tarefas: {error.message}
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Você ainda não tem tarefas atribuídas.
        </div>
      ) : (
        <CompanySummaryGrid
          items={companies.map(
            (c): CompanyCardItem => ({
              id: c.id,
              name: c.name,
              href: `/colaborador/${c.id}`,
              done: c.done,
              total: c.total,
              pending: c.pending,
              overdue: c.overdue,
              dueSoon: c.dueSoon,
              labels: labelsByCompany.get(c.id) ?? [],
            })
          )}
        />
      )}
    </AppShell>
  );
}
