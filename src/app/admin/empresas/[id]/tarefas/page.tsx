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

// Drill-down do funil da central da empresa (admin): lista dedicada com as
// tarefas DA EMPRESA no status/período clicado — mesmo padrão do dashboard
// (/admin/instancias). Cada tarefa abre o painel de detalhe unificado. O período
// (inclusive mês/intervalo) vem resolvido da URL, para o recorte bater com a
// central de onde o clique veio.
export default async function EmpresaTarefasPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { status?: string; periodo?: string; mes?: string; de?: string; ate?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const filter = normalizeStatusFilter(searchParams?.status);
  const period = resolvePeriod(searchParams);

  const [{ data: companyData }, list] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.id)
      .maybeSingle(),
    loadStatusInstances(supabase, {
      filter,
      start: period.start,
      end: period.end,
      companyId: params.id,
    }),
  ]);

  const company = companyData as { id: string; name: string } | null;
  if (!company) notFound();

  const { error, items, truncated, labelsByCompany } = list;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={statusListTitle(filter)}
      subtitle={`${company.name} · ${truncated ? "300+" : items.length} tarefa${
        items.length === 1 ? "" : "s"
      }`}
      back={{
        href: `/admin/empresas/${company.id}?${periodQuery(period)}`,
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
