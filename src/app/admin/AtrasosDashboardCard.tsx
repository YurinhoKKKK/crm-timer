import Link from "next/link";
import Person from "@/components/Person";

// Quadro "Atrasos" do Dashboard: três números + duas colunas (Por criador / Por
// responsável) com o Top 5 de quem mais atrasa, e o atalho para a auditoria
// completa. Componente de apresentação (server) — os dados já vêm agregados
// (atrasos_dashboard) e enriquecidos com foto/nome.

export type AtrasoTopPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  late: number;
  onTimePct: number;
};

function TopList({
  title,
  people,
  periodQuery,
  filterParam,
}: {
  title: string;
  people: AtrasoTopPerson[];
  periodQuery: string;
  filterParam: "fcriador" | "fresp";
}) {
  const top = people.slice(0, 5);
  const rest = people.length - top.length;
  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h4>
      {top.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2/40 px-3 py-4 text-center text-sm text-fg-subtle">
          Ninguém com atrasos no período.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {top.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/atrasos?${periodQuery}&${filterParam}=${p.id}`}
                className="group flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <span className="min-w-0 group-hover:text-risd">
                  <Person name={p.name} avatarUrl={p.avatarUrl} size={22} />
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  <span className="font-mono font-semibold tabular-nums text-fg">{p.late}</span>
                  <span className="font-mono text-xs tabular-nums text-fg-subtle">{p.onTimePct}% no prazo</span>
                </span>
              </Link>
            </li>
          ))}
          {rest > 0 && (
            <li className="pl-2 pt-1 text-xs text-fg-subtle">
              + {rest} {rest === 1 ? "pessoa" : "pessoas"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function AtrasosDashboardCard({
  totals,
  creators,
  responsibles,
  periodQuery,
}: {
  totals: { completedLate: number; openOverdue: number; expired: number };
  creators: AtrasoTopPerson[];
  responsibles: AtrasoTopPerson[];
  periodQuery: string;
}) {
  const NUMS = [
    { label: "Concluídas com atraso", value: totals.completedLate, tone: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
    { label: "Atrasadas em aberto", value: totals.openOverdue, tone: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
    { label: "Expiradas", value: totals.expired, tone: "text-fg", dot: "bg-fg-subtle" },
  ];

  return (
    <section className="mb-2 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Atrasos</h3>
        <Link
          href={`/admin/atrasos?${periodQuery}`}
          className="text-sm font-medium text-risd transition hover:text-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Ver auditoria completa →
        </Link>
      </div>

      <p className="mb-4 text-xs text-fg-subtle">
        Por prazo no período, sem tarefas padrão diárias.
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {NUMS.map((n) => (
          <div key={n.label} className="rounded-xl border border-line bg-surface-2/40 p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${n.dot}`} />
              <p className="text-sm text-fg-muted">{n.label}</p>
            </div>
            <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${n.tone}`}>
              {n.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopList title="Por criador" people={creators} periodQuery={periodQuery} filterParam="fcriador" />
        <TopList title="Por responsável" people={responsibles} periodQuery={periodQuery} filterParam="fresp" />
      </div>
    </section>
  );
}
