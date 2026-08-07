import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanySummaryGrid, {
  type CompanyCardItem,
} from "@/components/CompanySummaryGrid";
import { loadAllLabelsByCompany } from "@/lib/labels";
import { perfRoute } from "@/lib/perf";

type CompanyCountRow = {
  company_id: string;
  company_name: string | null;
  total: number;
  done: number;
  pending: number;
  overdue: number;
  due_soon: number;
};

export default async function ColaboradorPage() {
  const { supabase, profile } = await guardRole([
    "colaborador",
    "admin",
    "consultor",
  ]);

  const perf = perfRoute("/colaborador (Meu Trabalho)");
  // As duas leituras rodam juntas. As contagens por empresa são AGREGADAS NO
  // BANCO (não contando linhas em JS, que trunca em 1000 do PostgREST): a RPC,
  // escopada ao próprio usuário, já devolve uma linha por empresa onde ele tem
  // tarefa — o mesmo conjunto de antes. As etiquetas vêm de todas as empresas
  // que a RLS (cl_select) permite (mesmo conjunto).
  const [{ data: countData, error }, labelsByCompany] = await Promise.all([
    perf.timed(
      "rpc company_task_counts (do usuário)",
      supabase.rpc("company_task_counts", {
        p_start: null,
        p_collaborator: profile.id,
      })
    ),
    perf.timed("company_labels (paralela)", loadAllLabelsByCompany(supabase)),
  ]);
  perf.done();

  const companies = ((countData as CompanyCountRow[]) ?? [])
    .map((r) => ({
      id: r.company_id,
      name: r.company_name ?? "(empresa)",
      total: Number(r.total),
      done: Number(r.done),
      pending: Number(r.pending),
      overdue: Number(r.overdue),
      dueSoon: Number(r.due_soon),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

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
