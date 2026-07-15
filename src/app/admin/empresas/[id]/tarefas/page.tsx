import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import {
  loadStatusInstances,
  normalizeStatusFilter,
  statusListTitle,
} from "@/lib/instance-status";
import InstanceStatusList from "@/app/admin/instancias/InstanceStatusList";

type Period = "hoje" | "7d" | "30d" | "tudo";

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

// Drill-down do funil da central da empresa (admin): lista dedicada com as
// tarefas DA EMPRESA no status/período clicado — mesmo padrão do dashboard
// (/admin/instancias). Cada tarefa abre o painel de detalhe unificado.
export default async function EmpresaTarefasPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { status?: string; periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const filter = normalizeStatusFilter(searchParams?.status);
  const period = normalizePeriod(searchParams?.periodo);

  const [{ data: companyData }, list] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", params.id)
      .maybeSingle(),
    loadStatusInstances(supabase, {
      filter,
      start: periodStart(period),
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
        href: `/admin/empresas/${company.id}?periodo=${period}`,
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
