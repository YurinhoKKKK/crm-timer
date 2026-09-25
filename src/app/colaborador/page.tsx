import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import CompanySummaryGrid, {
  type CompanyCardItem,
} from "@/components/CompanySummaryGrid";
import { loadAllLabelsByCompany } from "@/lib/labels";
import { loadCompanyNoteCounts } from "@/lib/notes";
import { loadStartedOnByCompany } from "@/lib/company-details";
import { perfRoute } from "@/lib/perf";

type CompanyCountRow = {
  company_id: string;
  company_name: string | null;
  in_portfolio: boolean;
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
  // Mudança de âncora (0090): o painel lista as empresas em que a pessoa é
  // RESPONSÁVEL (carteira declarada), não mais toda empresa em que tem tarefa.
  // Exceção para não sumir trabalho: empresa com tarefa EM ABERTO continua
  // aparecendo mesmo sem vínculo, marcada como "fora da carteira". A RPC agrega
  // NO BANCO (não conta linhas em JS, que trunca em 1000) e devolve in_portfolio.
  const [{ data: countData, error }, labelsByCompany, noteCounts, startedOnByCompany] =
    await Promise.all([
      perf.timed(
        "rpc collaborator_portfolio (do usuário)",
        supabase.rpc("collaborator_portfolio", {
          p_collaborator: profile.id,
        })
      ),
      perf.timed("company_labels (paralela)", loadAllLabelsByCompany(supabase)),
      // Contagem de anotações por empresa (balão de atalho). Escopo = RLS
      // cn_select (as empresas onde o colaborador tem tarefa).
      perf.timed("rpc company_note_counts", loadCompanyNoteCounts(supabase)),
      // Início do contrato por empresa (etiqueta derivada "Cliente Novo"), numa
      // consulta só. RLS cd_select = as empresas onde o colaborador tem tarefa.
      perf.timed("company_details started_on", loadStartedOnByCompany(supabase)),
    ]);
  perf.done();

  const companies = ((countData as CompanyCountRow[]) ?? [])
    .map((r) => ({
      id: r.company_id,
      name: r.company_name ?? "(empresa)",
      inPortfolio: r.in_portfolio,
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
          Você ainda não é responsável por nenhuma empresa.
        </div>
      ) : (
        <CompanySummaryGrid
          viewerId={profile.id}
          viewerIsAdmin={profile.role === "admin"}
          notesHrefSuffix="#anotacoes"
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
              noteCount: noteCounts.get(c.id) ?? 0,
              startedOn: startedOnByCompany.get(c.id) ?? null,
              outOfPortfolio: !c.inPortfolio,
            })
          )}
        />
      )}
    </AppShell>
  );
}
