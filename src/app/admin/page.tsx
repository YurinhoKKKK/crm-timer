import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import { perfRoute } from "@/lib/perf";
import AppShell from "@/components/AppShell";
import type { TaskStatus } from "@/lib/types";
import PeriodFilter, { type Period } from "./PeriodFilter";
import TimeByCompanyChart, { type CompanyTime } from "./TimeByCompanyChart";
import CollaboratorSummary, {
  type CollaboratorRow,
} from "./CollaboratorSummary";

type InstanceRow = {
  company_id: string;
  collaborator_id: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
};

type Named = { id: string; name: string };
type Person = {
  id: string;
  full_name: string;
  email: string;
  avatar_path: string | null;
};

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

const STATUS_CARDS: {
  status: TaskStatus;
  label: string;
  dot: string;
  value: string;
}[] = [
  { status: "a_fazer", label: "A fazer", dot: "bg-fg-subtle", value: "text-fg" },
  { status: "iniciada", label: "Iniciadas", dot: "bg-risd", value: "text-risd" },
  {
    status: "finalizada",
    label: "Finalizadas",
    dot: "bg-emerald-500",
    value: "text-emerald-600 dark:text-emerald-400",
  },
  {
    status: "cancelada",
    label: "Canceladas",
    dot: "bg-fg-subtle",
    value: "text-fg-muted",
  },
];

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

// Início do período (string YYYY-MM-DD) para filtrar por task_date. null = tudo.
function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

const PERIOD_LABEL: Record<Period, string> = {
  hoje: "hoje",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  tudo: "em todo o período",
};

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0min";
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const period = normalizePeriod(searchParams?.periodo);
  const start = periodStart(period);

  let instancesQuery = supabase
    .from("task_instances")
    .select("company_id, collaborator_id, status, due_at, total_seconds");
  if (start) instancesQuery = instancesQuery.gte("task_date", start);

  const perf = perfRoute("/admin (dashboard)");
  const [
    { data: instancesData, error: instancesError },
    { data: companiesData },
    { data: collaboratorsData },
  ] = await Promise.all([
    perf.timed("task_instances (todas do período, sem limit)", instancesQuery),
    perf.timed("companies", supabase.from("companies").select("id, name")),
    // Todos os perfis (não só role=colaborador): admin/consultor que executam
    // tarefas também contam como responsáveis pelo tempo (Passo 14). Os que não
    // executaram nada são filtrados adiante por `total > 0`.
    perf.timed(
      "profiles",
      supabase.from("profiles").select("id, full_name, email, avatar_path")
    ),
  ]);
  perf.done();

  const instances = (instancesData as InstanceRow[]) ?? [];
  const companies = (companiesData as Named[]) ?? [];
  const collaborators = (collaboratorsData as Person[]) ?? [];

  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const statusCount: Record<TaskStatus, number> = {
    a_fazer: 0,
    iniciada: 0,
    finalizada: 0,
    cancelada: 0,
  };

  let totalSeconds = 0;
  let overdue = 0;
  const now = Date.now();

  const companyTime = new Map<string, number>();
  const perCollaborator = new Map<
    string,
    { seconds: number; total: number; done: number }
  >();

  for (const r of instances) {
    statusCount[r.status] += 1;
    totalSeconds += r.total_seconds;

    if (
      r.status !== "finalizada" &&
      r.status !== "cancelada" &&
      r.due_at &&
      new Date(r.due_at).getTime() < now
    ) {
      overdue += 1;
    }

    companyTime.set(
      r.company_id,
      (companyTime.get(r.company_id) ?? 0) + r.total_seconds
    );

    const c = perCollaborator.get(r.collaborator_id) ?? {
      seconds: 0,
      total: 0,
      done: 0,
    };
    c.seconds += r.total_seconds;
    c.total += 1;
    if (r.status === "finalizada") c.done += 1;
    perCollaborator.set(r.collaborator_id, c);
  }

  // Lista completa; o gráfico faz Top N + agrupamento da cauda (Passo 18).
  const chartData: CompanyTime[] = Array.from(companyTime.entries())
    .map(([id, seconds]) => ({
      id,
      name: companyName.get(id) ?? "(empresa removida)",
      seconds,
    }))
    .filter((d) => d.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const collaboratorRows: CollaboratorRow[] = collaborators
    .map((p) => {
      const stats = perCollaborator.get(p.id) ?? {
        seconds: 0,
        total: 0,
        done: 0,
      };
      return {
        id: p.id,
        name: p.full_name || p.email,
        avatarPath: p.avatar_path,
        seconds: stats.seconds,
        total: stats.total,
        done: stats.done,
        percent: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .map(({ seconds, ...r }) => ({
      ...r,
      timeLabel: formatDuration(seconds),
    }));

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Dashboard"
      subtitle={`Bem-vindo, ${profile.full_name}`}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">
          Visão geral · {PERIOD_LABEL[period]}
        </h2>
        <PeriodFilter value={period} />
      </div>

      {instancesError ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar os dados: {instancesError.message}
        </div>
      ) : (
        <>
          {/* Cards por status (clicáveis) */}
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATUS_CARDS.map((card) => (
              <Link
                key={card.status}
                href={`/admin/instancias?status=${card.status}&periodo=${period}`}
                className="group rounded-xl border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${card.dot}`} />
                  <p className="text-sm text-fg-muted">{card.label}</p>
                </div>
                <p
                  className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${card.value}`}
                >
                  {statusCount[card.status]}
                </p>
                <p className="mt-2 text-xs text-fg-subtle transition group-hover:text-risd">
                  Ver tarefas →
                </p>
              </Link>
            ))}
          </div>

          {/* Métricas extras */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-sm text-fg-muted">Tempo total gasto</p>
              <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-fg">
                {formatDuration(totalSeconds)}
              </p>
            </div>
            <Link
              href={`/admin/instancias?status=atrasadas&periodo=${period}`}
              className="group rounded-xl border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    overdue > 0 ? "bg-red-500" : "bg-fg-subtle"
                  }`}
                />
                <p className="text-sm text-fg-muted">Tarefas atrasadas</p>
              </div>
              <p
                className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${
                  overdue > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-fg"
                }`}
              >
                {overdue}
              </p>
              <p className="mt-2 text-xs text-fg-subtle transition group-hover:text-risd">
                Ver tarefas →
              </p>
            </Link>
          </div>

          {/* Ranking de empresas por tempo */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">
              Tempo por empresa
            </h3>
            <TimeByCompanyChart data={chartData} drilldownPeriod={period} />
          </section>

          {/* Resumo por colaborador */}
          <section className="mb-2 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">
              Resumo por responsável
            </h3>
            <CollaboratorSummary rows={collaboratorRows} period={period} />
          </section>
        </>
      )}
    </AppShell>
  );
}
