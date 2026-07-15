import Link from "next/link";
import Avatar from "@/components/Avatar";
import PeriodFilter, { type Period } from "@/app/admin/PeriodFilter";
import NewTaskForm from "@/app/admin/tarefas/NewTaskForm";
import CompanyStandardTasks from "@/components/CompanyStandardTasks";
import CompanyTaskList from "./CompanyTaskList";
import CreatorMeta from "@/components/CreatorMeta";
import LabelChips from "@/components/LabelChips";
import TaskDetailLink from "@/components/TaskDetailLink";
import { STATUS_META } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import { btnSecondary } from "@/lib/ui";
import type { CentralData } from "@/lib/company-central";

const PERIOD_LABEL: Record<Period, string> = {
  hoje: "hoje",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  tudo: "em todo o período",
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

// Card numérico dos indicadores (block 2). Com `href`, vira link: leva à
// lista de tarefas (âncora #tarefas) já filtrada pelo status do card.
function StatCard({
  label,
  value,
  dot,
  tone = "text-fg",
  href,
}: {
  label: string;
  value: number | string;
  dot?: string;
  tone?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        <p className="text-xs text-fg-muted">{label}</p>
      </div>
      <p className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${tone}`}>
        {value}
      </p>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="group rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        {inner}
        <p className="mt-1.5 text-[11px] text-fg-subtle transition group-hover:text-risd">
          Ver tarefas →
        </p>
      </Link>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      {inner}
    </div>
  );
}

// Central da empresa (Passo 19) — blocos de leitura + ações. Compartilhada por
// admin e consultor; o que muda entre eles é o acesso (RLS) e o `editHref`
// (só o admin edita os dados/vínculos da empresa).
export default function CompanyCentral({
  data,
  period,
  editHref,
  tasksHref,
}: {
  data: CentralData;
  period: Period;
  // Link para a tela de edição de dados/vínculos (admin). Ausente no consultor.
  editHref?: string;
  // Base da tela dedicada de tarefas da empresa (drill-down do funil) — muda
  // por painel: /admin/empresas/[id]/tarefas ou /consultor/[companyId]/tarefas.
  tasksHref: string;
}) {
  const { company, consultants, overview: o } = data;

  // Clique num card do funil → tela dedicada com a lista filtrada (mesmo
  // padrão do dashboard); o período atual é preservado.
  const taskHref = (status?: string) =>
    `${tasksHref}?periodo=${period}${status ? `&status=${status}` : ""}`;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">
          Visão geral · {PERIOD_LABEL[period]}
        </h2>
        <PeriodFilter value={period} />
      </div>

      {/* 1. Cabeçalho da empresa */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            {company.labels.length > 0 && (
              <LabelChips labels={company.labels} size="md" />
            )}
            <div>
              <p className="text-xs text-fg-subtle">Consultor(es) responsável(is)</p>
              {consultants.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {consultants.map((c) => (
                    <span
                      key={c.name}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-1 pr-2 text-xs text-fg-muted"
                    >
                      <Avatar name={c.name} url={c.avatarUrl} size={18} />
                      {c.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-fg-subtle">
                  Nenhum consultor vinculado.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <p className="text-fg-muted">
                Grupo de WhatsApp:{" "}
                <span className="text-fg">
                  {company.whatsappGroupName ||
                    (company.whatsappContactId ? "(sem nome)" : "não vinculado")}
                </span>
              </p>
            </div>
            <CreatorMeta
              label="Cadastrada por"
              who={company.creatorName}
              whoAvatarUrl={company.creatorAvatarUrl}
              whenISO={company.createdAt}
              dateOnly
              hasOrigin={!!company.creatorName}
              systemLabel="Cadastrada"
            />
          </div>
          {editHref && (
            <Link href={editHref} className={`${btnSecondary} shrink-0`}>
              Editar empresa
            </Link>
          )}
        </div>
      </section>

      {/* Ação: nova tarefa (empresa pré-selecionada) */}
      {data.collaborators.length > 0 && (
        <NewTaskForm
          companies={[{ id: company.id, name: company.name }]}
          collaborators={data.collaborators}
          lockedCompany={{ id: company.id, name: company.name }}
        />
      )}

      {/* 2. Indicadores (clicáveis: abrem a lista filtrada pelo status) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" value={o.total} href={taskHref()} />
        <StatCard
          label="A fazer"
          value={o.a_fazer}
          dot={STATUS_META.a_fazer.dot}
          href={taskHref("a_fazer")}
        />
        <StatCard
          label="Em andamento"
          value={o.iniciada}
          dot={STATUS_META.iniciada.dot}
          tone="text-risd"
          href={taskHref("iniciada")}
        />
        <StatCard
          label="Finalizadas"
          value={o.finalizada}
          dot={STATUS_META.finalizada.dot}
          tone="text-emerald-600 dark:text-emerald-400"
          href={taskHref("finalizada")}
        />
        <StatCard
          label="Atrasadas"
          value={o.overdue}
          dot={o.overdue > 0 ? "bg-red-500" : "bg-fg-subtle"}
          tone={o.overdue > 0 ? "text-red-600 dark:text-red-400" : "text-fg"}
          href={taskHref("atrasadas")}
        />
        <StatCard
          label="Canceladas"
          value={o.cancelada}
          dot={STATUS_META.cancelada.dot}
          tone="text-fg-muted"
          href={taskHref("cancelada")}
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label={`Tempo ${PERIOD_LABEL[period]}`}
          value={formatDuration(o.secondsPeriod)}
        />
        <StatCard label="Tempo no mês atual" value={formatDuration(o.secondsMonth)} />
        <StatCard
          label="Tempo total da empresa"
          value={formatDuration(o.secondsAll)}
        />
      </div>

      {/* 3. Progresso */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-2 flex items-center justify-between text-sm text-fg-muted">
          <span className="font-medium text-fg">Progresso {PERIOD_LABEL[period]}</span>
          <span className="font-mono tabular-nums">
            {o.finalizada} de {o.total} concluída{o.total === 1 ? "" : "s"} ·{" "}
            {o.percent}%
          </span>
        </div>
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={o.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-risd transition-all"
            style={{ width: `${o.percent}%` }}
          />
        </div>
      </section>

      {/* 4. Atrasadas / pendentes em destaque */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">Atrasadas e pendentes</h3>
          {o.overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {o.overdue} atrasada{o.overdue === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {data.attention.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-subtle">
            Nenhuma tarefa pendente no período. 🎉
          </p>
        ) : (
          <ul className="space-y-2">
            {data.attention.slice(0, 8).map((t) => {
              const meta = STATUS_META[t.status];
              return (
                <li key={t.id}>
                  {/* Clique abre o painel de detalhe unificado da tarefa. */}
                  <TaskDetailLink
                    taskId={t.id}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
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
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                        {t.overdue && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                            Atrasada
                          </span>
                        )}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                        <Avatar
                          name={t.collaboratorName}
                          url={t.collaboratorAvatarUrl}
                          size={18}
                        />
                        {t.collaboratorName}
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
                  </TaskDetailLink>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 5. Lista de tarefas */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <h3 className="mb-4 text-sm font-semibold text-fg">
          Tarefas {PERIOD_LABEL[period]}
        </h3>
        <CompanyTaskList
          tasks={data.tasks}
          truncated={data.tasksTruncated}
          labels={company.labels}
          groupStats={data.groupStats}
        />
      </section>

      {/* 6. Resumo por colaborador */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <h3 className="mb-4 text-sm font-semibold text-fg">
          Resumo por colaborador
        </h3>
        {data.collaboratorRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-subtle">
            Nenhum colaborador com tarefas no período.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.collaboratorRows.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={c.name} url={c.avatarUrl} size={36} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{c.name}</p>
                    <p className="text-xs text-fg-subtle">
                      {c.done}/{c.total} concluída{c.total === 1 ? "" : "s"} ·{" "}
                      {c.percent}%
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                  {c.timeLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 7. Histórico de atividades */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <h3 className="mb-4 text-sm font-semibold text-fg">
          Histórico de atividades
        </h3>
        {data.activity.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-subtle">
            Nenhuma atividade registrada no período.
          </p>
        ) : (
          <ol className="space-y-4">
            {data.activity.map((a) => (
              <li key={a.id} className="relative border-l-2 border-line pl-4">
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-risd" />
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                  <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                    <Avatar
                      name={a.collaboratorName}
                      url={a.collaboratorAvatarUrl}
                      size={18}
                    />
                    {a.collaboratorName}
                  </span>
                  <span>·</span>
                  <span>{formatDateTime(a.createdAt)}</span>
                  <span>·</span>
                  <span className="font-mono tabular-nums">
                    {formatDuration(a.seconds)}
                  </span>
                  {a.sentWhatsapp && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      WhatsApp
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">
                  {a.message}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 8. Tarefas padrão desta empresa */}
      {data.standards.length > 0 && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h3 className="mb-1 font-semibold text-fg">
            Tarefas padrão desta empresa
          </h3>
          <p className="mb-4 text-sm text-fg-muted">
            Selecione as tarefas do catálogo que esta empresa usa e o responsável
            de cada uma. Editar a padrão no catálogo atualiza as tarefas em aberto
            aqui.
          </p>
          <CompanyStandardTasks
            companyId={company.id}
            standards={data.standards}
            collaborators={data.collaborators}
            current={data.currentStandardTasks}
          />
        </section>
      )}
    </>
  );
}
