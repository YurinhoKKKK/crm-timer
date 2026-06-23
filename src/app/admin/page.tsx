import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
import type { TaskStatus } from "@/lib/types";
import PeriodFilter, { type Period } from "./PeriodFilter";
import TimeByCompanyChart, { type CompanyTime } from "./TimeByCompanyChart";

type InstanceRow = {
  company_id: string;
  collaborator_id: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
};

type Named = { id: string; name: string };
type Person = { id: string; full_name: string; email: string };

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

const STATUS_CARDS: {
  status: TaskStatus;
  label: string;
  accent: string;
}[] = [
  { status: "a_fazer", label: "A fazer", accent: "text-gunmetal" },
  { status: "iniciada", label: "Iniciadas", accent: "text-risd" },
  { status: "finalizada", label: "Finalizadas", accent: "text-green-600" },
  { status: "cancelada", label: "Canceladas", accent: "text-gunmetal/40" },
];

const NAV_SECTIONS = [
  {
    href: "/admin/usuarios",
    title: "Usuários",
    description: "Liberar acessos e definir cargos.",
  },
  {
    href: "/admin/empresas",
    title: "Empresas",
    description: "Cadastrar clientes e vincular grupos de WhatsApp.",
  },
  {
    href: "/admin/tarefas",
    title: "Tarefas",
    description: "Criar tarefas únicas ou diárias.",
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

  const [
    { data: instancesData, error: instancesError },
    { data: companiesData },
    { data: collaboratorsData },
  ] = await Promise.all([
    instancesQuery,
    supabase.from("companies").select("id, name"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "colaborador"),
  ]);

  const instances = (instancesData as InstanceRow[]) ?? [];
  const companies = (companiesData as Named[]) ?? [];
  const collaborators = (collaboratorsData as Person[]) ?? [];

  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  // Contagem por status.
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

  const chartData: CompanyTime[] = Array.from(companyTime.entries())
    .map(([id, seconds]) => ({
      name: companyName.get(id) ?? "(empresa removida)",
      seconds,
    }))
    .filter((d) => d.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 8);

  const collaboratorRows = collaborators
    .map((p) => {
      const stats = perCollaborator.get(p.id) ?? {
        seconds: 0,
        total: 0,
        done: 0,
      };
      return {
        id: p.id,
        name: p.full_name || p.email,
        seconds: stats.seconds,
        total: stats.total,
        done: stats.done,
        percent: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.seconds - a.seconds);

  return (
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gunmetal">
              Painel do Administrador
            </h1>
            <p className="text-sm text-gunmetal/60">
              Bem-vindo, {profile.full_name}
            </p>
          </div>
          <LogoutButton />
        </header>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gunmetal/70">
            Visão geral · {PERIOD_LABEL[period]}
          </h2>
          <PeriodFilter value={period} />
        </div>

        {instancesError ? (
          <div className="mb-8 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
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
                  className="group rounded-xl border border-platinum bg-white p-5 shadow-sm transition hover:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
                >
                  <p className="text-sm text-gunmetal/60">{card.label}</p>
                  <p className={`mt-1 text-3xl font-semibold ${card.accent}`}>
                    {statusCount[card.status]}
                  </p>
                  <p className="mt-2 text-xs text-gunmetal/40 group-hover:text-risd">
                    Ver tarefas →
                  </p>
                </Link>
              ))}
            </div>

            {/* Métricas extras */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-platinum bg-white p-5 shadow-sm">
                <p className="text-sm text-gunmetal/60">Tempo total gasto</p>
                <p className="mt-1 text-3xl font-semibold text-gunmetal">
                  {formatDuration(totalSeconds)}
                </p>
              </div>
              <Link
                href={`/admin/instancias?status=atrasadas&periodo=${period}`}
                className="group rounded-xl border border-platinum bg-white p-5 shadow-sm transition hover:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
              >
                <p className="text-sm text-gunmetal/60">Tarefas atrasadas</p>
                <p
                  className={`mt-1 text-3xl font-semibold ${
                    overdue > 0 ? "text-red-600" : "text-gunmetal"
                  }`}
                >
                  {overdue}
                </p>
                <p className="mt-2 text-xs text-gunmetal/40 group-hover:text-risd">
                  Ver tarefas →
                </p>
              </Link>
            </div>

            {/* Ranking de empresas por tempo */}
            <section className="mb-8 rounded-xl border border-platinum bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-medium text-gunmetal/70">
                Tempo por empresa
              </h3>
              <TimeByCompanyChart data={chartData} />
            </section>

            {/* Resumo por colaborador */}
            <section className="mb-8 rounded-xl border border-platinum bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-medium text-gunmetal/70">
                Resumo por colaborador
              </h3>
              {collaboratorRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-gunmetal/40">
                  Nenhuma atividade de colaborador no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-platinum text-left text-xs text-gunmetal/50">
                        <th className="pb-2 font-medium">Colaborador</th>
                        <th className="pb-2 text-right font-medium">Tempo</th>
                        <th className="pb-2 text-right font-medium">Tarefas</th>
                        <th className="pb-2 pl-4 font-medium">Concluídas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collaboratorRows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-platinum/60 last:border-0"
                        >
                          <td className="py-2.5 pr-4 font-medium text-gunmetal">
                            {r.name}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-gunmetal/70">
                            {formatDuration(r.seconds)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-gunmetal/70">
                            {r.done}/{r.total}
                          </td>
                          <td className="py-2.5 pl-4">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2 w-24 overflow-hidden rounded-full bg-platinum"
                                role="progressbar"
                                aria-valuenow={r.percent}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              >
                                <div
                                  className="h-full rounded-full bg-risd"
                                  style={{ width: `${r.percent}%` }}
                                />
                              </div>
                              <span className="tabular-nums text-xs text-gunmetal/60">
                                {r.percent}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* Navegação */}
        <h2 className="mb-3 text-sm font-medium text-gunmetal/70">Gerenciar</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {NAV_SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group rounded-xl border border-platinum bg-white p-5 shadow-sm transition hover:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
            >
              <h3 className="font-medium text-gunmetal group-hover:text-risd">
                {section.title}
              </h3>
              <p className="mt-1 text-sm text-gunmetal/60">
                {section.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
