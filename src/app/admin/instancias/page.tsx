import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import {
  loadStatusInstances,
  normalizeStatusFilter,
  statusListTitle,
} from "@/lib/instance-status";
import { periodStart, type PeriodKey } from "@/lib/period";
import InstanceStatusList from "./InstanceStatusList";

type Period = PeriodKey;

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

// Drill-down do dashboard (admin): lista de tarefas por status/atrasadas no
// período. A leitura vem do núcleo compartilhado (lib/instance-status), o
// mesmo das listas por status das centrais de empresa.
export default async function InstanciasPage({
  searchParams,
}: {
  searchParams: { status?: string; periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const filter = normalizeStatusFilter(searchParams?.status);
  const period = normalizePeriod(searchParams?.periodo);

  const { error, items, truncated, labelsByCompany } = filter
    ? await loadStatusInstances(supabase, {
        filter,
        start: periodStart(period),
      })
    : { error: null, items: [], truncated: false, labelsByCompany: {} };

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title={filter ? statusListTitle(filter) : "Tarefas"}
      subtitle={`${truncated ? "300+" : items.length} tarefa${
        items.length === 1 ? "" : "s"
      }`}
      back={{ href: `/admin?periodo=${period}`, label: "Dashboard" }}
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
