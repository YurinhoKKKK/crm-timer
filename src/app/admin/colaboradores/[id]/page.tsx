import { notFound } from "next/navigation";
import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { formatDuration, formatDue } from "@/lib/format";
import { STATUS_META } from "@/lib/status";
import type { TaskStatus } from "@/lib/types";
import type { SelectOption } from "@/components/ListControls";
import AdjustableTaskList, {
  type AdjustItem,
  type Adjustment,
} from "./AdjustableTaskList";
import TimeByCompanyChart, { type CompanyTime } from "../../TimeByCompanyChart";
import PeriodFilter, { type Period } from "../../PeriodFilter";

type Joined<T> = T | T[] | null;

type InstanceRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  total_seconds: number;
  company_id: string;
  company: Joined<{ name: string }>;
};

type ActivityRow = {
  id: string;
  message: string;
  seconds_spent: number;
  sent_whatsapp: boolean;
  created_at: string;
  company: Joined<{ name: string }>;
};

function first<T>(value: Joined<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

const PERIODS: Period[] = ["hoje", "7d", "30d", "tudo"];

const PERIOD_LABEL: Record<Period, string> = {
  hoje: "hoje",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  tudo: "em todo o período",
};

function normalizePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.includes(v as Period) ? (v as Period) : "30d";
}

// Início do período (YYYY-MM-DD) para filtrar por task_date / created_at.
function periodStart(period: Period): string | null {
  if (period === "tudo") return null;
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  consultor: "Consultor",
  colaborador: "Colaborador",
  pending: "Pendente",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Opções de <select> únicas (por id) ordenadas por rótulo.
function dedupe(pairs: [string, string][]): SelectOption[] {
  const map = new Map<string, string>();
  for (const [value, label] of pairs) {
    if (!map.has(value)) map.set(value, label);
  }
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export default async function CollaboratorDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { periodo?: string };
}) {
  const { supabase, profile } = await guardRole(["admin"]);

  const period = normalizePeriod(searchParams?.periodo);
  const start = periodStart(period);

  // Perfil do colaborador (RLS: is_admin() libera leitura de qualquer perfil).
  const { data: personData } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, avatar_path")
    .eq("id", params.id)
    .single();

  if (!personData) notFound();
  const person = personData as {
    id: string;
    full_name: string | null;
    email: string;
    role: string;
    avatar_path: string | null;
  };
  const personName = person.full_name || person.email;

  // Tarefas do colaborador no período (RLS: is_admin() libera).
  let instancesQuery = supabase
    .from("task_instances")
    .select(
      "id, title, status, due_at, total_seconds, company_id, company:companies!task_instances_company_id_fkey(name)"
    )
    .eq("collaborator_id", params.id)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (start) instancesQuery = instancesQuery.gte("task_date", start);

  // Histórico recente de atividades do colaborador no período.
  let activityQuery = supabase
    .from("activity_log")
    .select(
      "id, message, seconds_spent, sent_whatsapp, created_at, company:companies!activity_log_company_id_fkey(name)"
    )
    .eq("collaborator_id", params.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (start) activityQuery = activityQuery.gte("created_at", start);

  const [{ data: instancesData, error }, { data: activityData }] =
    await Promise.all([instancesQuery, activityQuery]);

  const instances = (instancesData as InstanceRow[]) ?? [];
  const activities = (activityData as ActivityRow[]) ?? [];

  // Ajustes manuais de tempo (Passo 16) das tarefas listadas, para o selo
  // "tempo ajustado" e o histórico. RLS ta_select libera para o admin.
  const instanceIds = instances.map((r) => r.id);
  const { data: adjustmentsData } =
    instanceIds.length > 0
      ? await supabase
          .from("time_adjustments")
          .select(
            "task_id, old_seconds, new_seconds, reason, created_at, adjuster:profiles!time_adjustments_adjusted_by_fkey(full_name, email)"
          )
          .in("task_id", instanceIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  type AdjustmentRow = {
    task_id: string;
    old_seconds: number;
    new_seconds: number;
    reason: string | null;
    created_at: string;
    adjuster: Joined<{ full_name: string | null; email: string }>;
  };

  const adjustmentsByTask = new Map<string, Adjustment[]>();
  for (const a of (adjustmentsData as AdjustmentRow[]) ?? []) {
    const adjuster = first(a.adjuster);
    const list = adjustmentsByTask.get(a.task_id) ?? [];
    list.push({
      oldSeconds: a.old_seconds,
      newSeconds: a.new_seconds,
      reason: a.reason,
      at: a.created_at,
      by: adjuster?.full_name || adjuster?.email || "admin",
    });
    adjustmentsByTask.set(a.task_id, list);
  }

  // --- Métricas do cabeçalho ---
  let totalSeconds = 0;
  let done = 0;
  const total = instances.length;
  const now = Date.now();

  const companyTime = new Map<string, { name: string; seconds: number }>();

  for (const r of instances) {
    totalSeconds += r.total_seconds;
    if (r.status === "finalizada") done += 1;

    const cName = first(r.company)?.name ?? "(empresa removida)";
    const ct = companyTime.get(r.company_id) ?? { name: cName, seconds: 0 };
    ct.seconds += r.total_seconds;
    companyTime.set(r.company_id, ct);
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  // --- Tempo por empresa (mesmo gráfico da dashboard) ---
  const chartData: CompanyTime[] = Array.from(companyTime.values())
    .map((c) => ({ name: c.name, seconds: c.seconds }))
    .filter((d) => d.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 8);

  // --- Itens para a lista com busca/filtros + ajuste de tempo ---
  const items: AdjustItem[] = instances.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    total_seconds: r.total_seconds,
    companyId: r.company_id,
    companyName: first(r.company)?.name ?? "(empresa removida)",
    adjustments: adjustmentsByTask.get(r.id) ?? [],
  }));
  const companyOptions = dedupe(items.map((i) => [i.companyId, i.companyName]));

  // --- Atrasadas / pendentes em destaque ---
  const attention = instances
    .filter((r) => r.status === "a_fazer" || r.status === "iniciada")
    .map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      due_at: r.due_at,
      companyName: first(r.company)?.name ?? "(empresa removida)",
      overdue: !!r.due_at && new Date(r.due_at).getTime() < now,
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });
  const overdueCount = attention.filter((a) => a.overdue).length;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Detalhe do colaborador"
      subtitle={personName}
      back={{ href: `/admin?periodo=${period}`, label: "Dashboard" }}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">
          Visão geral · {PERIOD_LABEL[period]}
        </h2>
        <PeriodFilter value={period} />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar os dados: {error.message}
        </div>
      ) : (
        <>
          {/* Cabeçalho: identidade + números gerais */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <Avatar
                  name={personName}
                  url={avatarUrl(person.avatar_path)}
                  size={56}
                />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-fg">
                    {personName}
                  </p>
                  <p className="truncate text-sm text-fg-muted">{person.email}</p>
                  <span className="mt-1 inline-block rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-risd">
                    {ROLE_LABEL[person.role] ?? person.role}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                <div className="rounded-xl border border-line bg-surface-2/40 p-4 sm:border-0 sm:bg-transparent sm:p-0 sm:text-right">
                  <p className="text-xs text-fg-muted">Tempo total</p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">
                    {formatDuration(totalSeconds)}
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-surface-2/40 p-4 sm:border-0 sm:bg-transparent sm:p-0 sm:text-right">
                  <p className="text-xs text-fg-muted">Tarefas concluídas</p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-risd">
                    {percent}%
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {done}/{total} tarefas
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Atrasadas / pendentes em destaque */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">
                Atrasadas e pendentes
              </h3>
              {overdueCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                  {overdueCount} atrasada{overdueCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {attention.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-subtle">
                Nenhuma tarefa pendente no período. 🎉
              </p>
            ) : (
              <ul className="space-y-2">
                {attention.map((t) => {
                  const meta = STATUS_META[t.status];
                  return (
                    <li
                      key={t.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${
                        t.overdue
                          ? "border-red-300/60 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
                          : "border-line bg-surface-2/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-fg">{t.title}</span>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                            />
                            {meta.label}
                          </span>
                          {t.overdue && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                              Atrasada
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-fg-muted">
                          {t.companyName}
                        </p>
                      </div>
                      <span
                        className={`text-xs ${
                          t.overdue
                            ? "font-medium text-red-600 dark:text-red-400"
                            : "text-fg-subtle"
                        }`}
                      >
                        Prazo: {formatDue(t.due_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Tempo por empresa */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">
              Tempo por empresa
            </h3>
            <TimeByCompanyChart data={chartData} />
          </section>

          {/* Lista de tarefas com busca/filtros + ajuste de tempo (Passo 16) */}
          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-1 text-sm font-semibold text-fg">
              Tarefas ({total})
            </h3>
            <p className="mb-4 text-xs text-fg-subtle">
              Como admin, você pode corrigir o tempo de uma tarefa (ex.: alguém
              esqueceu de pausar). Toda correção fica registrada.
            </p>
            <AdjustableTaskList
              items={items}
              collaboratorId={person.id}
              companies={companyOptions}
            />
          </section>

          {/* Histórico de atividades recentes */}
          <section className="mb-2 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h3 className="mb-4 text-sm font-semibold text-fg">
              Atividades recentes
            </h3>
            {activities.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-subtle">
                Nenhuma atividade registrada no período.
              </p>
            ) : (
              <ol className="space-y-4">
                {activities.map((a) => {
                  const cName = first(a.company)?.name ?? "(empresa removida)";
                  return (
                    <li
                      key={a.id}
                      className="relative border-l-2 border-line pl-4"
                    >
                      <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-risd" />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                        <span className="font-medium text-fg">{cName}</span>
                        <span>·</span>
                        <span>{formatDateTime(a.created_at)}</span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">
                          {formatDuration(a.seconds_spent)}
                        </span>
                        {a.sent_whatsapp && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            WhatsApp
                          </span>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">
                        {a.message}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
