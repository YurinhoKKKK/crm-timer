import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import {
  loadPeriodInstances,
  normalizeStatusFilter,
  statusListTitle,
} from "@/lib/instance-status";
import { resolveDashboardPeriod, dashboardQuery } from "@/lib/period";
import InstanceStatusList from "./InstanceStatusList";

// Drill-down do dashboard (admin): lista de tarefas por status/atrasadas no
// período. Usa EXATAMENTE o mesmo critério das contagens dos cards (RPC
// tasks_in_period / task_in_period): prazo no período + atrasada em aberto.
export default async function InstanciasPage({
  searchParams,
}: {
  searchParams: { status?: string; periodo?: string; de?: string; ate?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const filter = normalizeStatusFilter(searchParams?.status);
  const period = resolveDashboardPeriod(searchParams ?? {});

  const { error, items, truncated, labelsByCompany } = filter
    ? await loadPeriodInstances(supabase, {
        filter,
        start: period.start,
        end: period.end,
      })
    : { error: null, items: [], truncated: false, labelsByCompany: {} };

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={filter ? statusListTitle(filter) : "Tarefas"}
      subtitle={`${truncated ? "300+" : items.length} tarefa${
        items.length === 1 ? "" : "s"
      }`}
      back={{ href: `/admin?${dashboardQuery(period)}`, label: "Dashboard" }}
    >
      {!filter ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Selecione um status no painel.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar tarefas: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Nenhuma tarefa neste status no período selecionado.
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
