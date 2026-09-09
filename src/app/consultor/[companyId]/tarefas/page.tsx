import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import {
  loadStatusInstances,
  normalizeStatusFilter,
  statusListTitle,
} from "@/lib/instance-status";
import { resolvePeriod, periodQuery } from "@/lib/period";
import InstanceStatusList from "@/app/admin/instancias/InstanceStatusList";

// Drill-down do funil da central da empresa (consultor): lista dedicada com
// as tarefas DA EMPRESA no status/período clicado — mesmo padrão do dashboard
// do admin. A RLS (companies_select / ti_select) só devolve dados de empresas
// atribuídas ao consultor; empresa fora do escopo cai em notFound. O período
// (inclusive mês/intervalo) vem resolvido da URL, batendo com a central.
export default async function ConsultorEmpresaTarefasPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { status?: string; periodo?: string; mes?: string; de?: string; ate?: string };
}) {
  const { supabase, profile } = await guardRole(["consultor"]);

  const filter = normalizeStatusFilter(searchParams?.status);
  const period = resolvePeriod(searchParams);

  const [{ data: companyData }, list] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.companyId)
      .maybeSingle(),
    loadStatusInstances(supabase, {
      filter,
      start: period.start,
      end: period.end,
      companyId: params.companyId,
    }),
  ]);

  const company = companyData as { id: string; name: string } | null;
  if (!company) notFound();

  const { error, items, truncated, labelsByCompany } = list;

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "consultor",
        avatarUrl: profile.avatarUrl,
      }}
      title={statusListTitle(filter)}
      subtitle={`${company.name} · ${truncated ? "300+" : items.length} tarefa${
        items.length === 1 ? "" : "s"
      }`}
      back={{
        href: `/consultor/${company.id}?${periodQuery(period)}`,
        label: company.name,
      }}
    >
      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Nenhuma tarefa neste recorte no período selecionado.
        </div>
      ) : (
        <InstanceStatusList
          items={items}
          truncated={truncated}
          labelsByCompany={labelsByCompany}
        />
      )}
    </AppShell>
  );
}
