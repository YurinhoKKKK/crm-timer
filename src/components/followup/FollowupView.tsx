"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import {
  farolOf,
  KIND_LABEL,
  FOLLOWUP_PERIODS,
  type Farol,
  type FollowupRow,
} from "@/lib/followup";

const TZ = "America/Sao_Paulo";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Identidade do semáforo (cor + rótulo em TEXTO — a cor nunca é o único sinal).
const FAROL_UI: Record<
  Farol,
  { label: string; dot: string; chip: string; text: string }
> = {
  verde: {
    label: "Em dia",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  amarelo: {
    label: "Atenção",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    text: "text-amber-700 dark:text-amber-300",
  },
  vermelho: {
    label: "Sem contato",
    dot: "bg-red-500",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    text: "text-red-700 dark:text-red-300",
  },
};

function periodSummary(p: FollowupRow["period"]): string {
  const parts: string[] = [];
  if (p.meetings) parts.push(`${p.meetings} ${p.meetings === 1 ? "reunião" : "reuniões"}`);
  if (p.notes) parts.push(`${p.notes} ${p.notes === 1 ? "anotação" : "anotações"}`);
  if (p.listings) parts.push(`${p.listings} ${p.listings === 1 ? "listagem" : "listagens"}`);
  if (p.readjusts) parts.push(`${p.readjusts} ${p.readjusts === 1 ? "reajuste" : "reajustes"}`);
  if (p.tasks) parts.push(`${p.tasks} ${p.tasks === 1 ? "tarefa" : "tarefas"}`);
  return parts.join(" · ");
}

export default function FollowupView({
  rows,
  period,
  role,
}: {
  rows: FollowupRow[];
  period: number;
  role: "admin" | "consultor";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [consultantId, setConsultantId] = useState("");
  const [farol, setFarol] = useState<Farol | "">("");

  // Consultores presentes (para o filtro do admin). Ordem alfabética — neutra.
  const consultantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows)
      for (const c of r.consultants)
        if (!map.has(c.id)) map.set(c.id, c.name || "(sem nome)");
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR")
    );
  }, [rows]);

  // Recorte por consultor (só filtra a lista; NÃO reordena por "melhor").
  const byConsultant = useMemo(
    () =>
      consultantId
        ? rows.filter((r) => r.consultants.some((c) => c.id === consultantId))
        : rows,
    [rows, consultantId]
  );

  // Contagem por faixa (sobre o recorte de consultor, ignorando o filtro de faixa).
  const bands = useMemo(() => {
    const b = { verde: 0, amarelo: 0, vermelho: 0 };
    for (const r of byConsultant) b[farolOf(r.daysSince)] += 1;
    return b;
  }, [byConsultant]);

  const filtered = useMemo(
    () => (farol ? byConsultant.filter((r) => farolOf(r.daysSince) === farol) : byConsultant),
    [byConsultant, farol]
  );

  function setPeriod(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("periodo", String(p));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const total = byConsultant.length;

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <PeriodTabs period={period} onChange={setPeriod} />
        {role === "admin" && consultantOptions.length > 0 && (
          <select
            value={consultantId}
            onChange={(e) => setConsultantId(e.target.value)}
            aria-label="Filtrar por consultor responsável"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <option value="">Todos os consultores</option>
            {consultantOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Faixas do semáforo — também filtram a lista ao clicar. */}
      <div className="flex flex-wrap gap-2">
        <BandChip
          active={farol === ""}
          onClick={() => setFarol("")}
          label="Todos"
          count={total}
        />
        {(["verde", "amarelo", "vermelho"] as Farol[]).map((f) => (
          <BandChip
            key={f}
            active={farol === f}
            onClick={() => setFarol(farol === f ? "" : f)}
            label={FAROL_UI[f].label}
            count={bands[f]}
            farol={f}
          />
        ))}
        <p className="ml-auto self-center text-xs text-fg-subtle">
          Faixas: verde até 7 dias · amarelo 7–15 · vermelho acima de 15
        </p>
      </div>

      {/* Lista */}
      {rows.length === 0 ? (
        <EmptyCard>
          Você ainda não tem empresas na carteira para acompanhar.
        </EmptyCard>
      ) : filtered.length === 0 ? (
        <EmptyCard good>
          {farol === "verde"
            ? "Nenhum cliente marcado como “em dia” neste recorte."
            : farol === "amarelo"
            ? "Nenhum cliente na faixa de atenção. 👏"
            : farol === "vermelho"
            ? "Boa notícia: nenhum cliente sem contato há mais de 15 dias. 🎉"
            : "Nenhum cliente neste recorte."}
        </EmptyCard>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((r) => (
            <CompanyRow key={r.companyId} row={r} role={role} />
          ))}
        </ul>
      )}

      {/* Recorte por consultor (visão secundária) — carteira precisando de
          atenção, NUNCA ranking. Só faz sentido para o admin (vários). */}
      {role === "admin" && (
        <ConsultantBreakdown rows={rows} />
      )}
    </div>
  );
}

function PeriodTabs({
  period,
  onChange,
}: {
  period: number;
  onChange: (p: number) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Período de análise"
      className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5"
    >
      {FOLLOWUP_PERIODS.map((p) => {
        const active = period === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
              active ? "bg-brand-tint text-risd" : "text-fg-muted hover:text-fg"
            }`}
          >
            {p} dias
          </button>
        );
      })}
    </div>
  );
}

function BandChip({
  active,
  onClick,
  label,
  count,
  farol,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  farol?: Farol;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
        active
          ? "border-risd/50 bg-brand-tint text-fg"
          : "border-line bg-surface text-fg-muted hover:text-fg"
      }`}
    >
      {farol && <span className={`h-2.5 w-2.5 rounded-full ${FAROL_UI[farol].dot}`} />}
      {label}
      <span className="tabular-nums text-fg-subtle">{count}</span>
    </button>
  );
}

function CompanyRow({
  row,
  role,
}: {
  row: FollowupRow;
  role: "admin" | "consultor";
}) {
  const f = farolOf(row.daysSince);
  const ui = FAROL_UI[f];
  const href =
    role === "admin"
      ? `/admin/empresas/${row.companyId}`
      : `/consultor/${row.companyId}`;
  const summary = periodSummary(row.period);

  const daysText =
    row.daysSince === null
      ? "Nunca contatado"
      : row.daysSince === 0
      ? "Contato hoje"
      : `${row.daysSince} ${row.daysSince === 1 ? "dia" : "dias"} sem contato`;

  return (
    <li>
      <Link
        href={href}
        className="group flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        {/* Faixa colorida do semáforo (identidade forte, mas o texto abaixo repete
            o estado — cor nunca sozinha). */}
        <span className={`mt-0.5 w-1.5 shrink-0 self-stretch rounded-full ${ui.dot}`} aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-fg group-hover:text-risd">
              {row.companyName}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ui.chip}`}
            >
              <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
              {ui.label} · {daysText}
            </span>
          </div>

          {/* Consultor(es) responsável(is) */}
          {row.consultants.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.consultants.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-1 pr-2 text-xs text-fg-muted"
                >
                  <Avatar name={c.name || "?"} url={avatarUrl(c.avatarPath)} size={18} />
                  {c.name || "(sem nome)"}
                </span>
              ))}
            </div>
          )}

          {/* Último contato + resumo do período */}
          <p className="mt-2 text-sm text-fg-muted">
            {row.lastContactAt && row.lastContactKind ? (
              <>
                Último contato:{" "}
                <span className="text-fg">{KIND_LABEL[row.lastContactKind]}</span> em{" "}
                <span className="tabular-nums">{fmtDate(row.lastContactAt)}</span>
              </>
            ) : (
              <span className={ui.text}>Nenhum contato registrado ainda</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {summary ? summary : "Sem contatos no período selecionado"}
          </p>

          {/* Reunião marcada (futuro) — engajamento planejado, distinto da
              realizada. Reassegura mesmo num cliente “frio”. */}
          {row.nextMeetingAt && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-tint px-2 py-1 text-xs font-medium text-risd">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Reunião marcada para {fmtDate(row.nextMeetingAt)}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

// Recorte por consultor: quantos clientes DELE em cada faixa. Ordem alfabética,
// sem pódio, sem "melhor" — é carteira precisando de atenção, não produtividade.
function ConsultantBreakdown({ rows }: { rows: FollowupRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { name: string; verde: number; amarelo: number; vermelho: number }
    >();
    const bump = (id: string, name: string, f: Farol) => {
      const g = map.get(id) ?? { name, verde: 0, amarelo: 0, vermelho: 0 };
      g[f] += 1;
      map.set(id, g);
    };
    for (const r of rows) {
      const f = farolOf(r.daysSince);
      if (r.consultants.length === 0) bump("__none__", "Sem responsável", f);
      else for (const c of r.consultants) bump(c.id, c.name || "(sem nome)", f);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR")
    );
  }, [rows]);

  if (groups.length === 0) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold text-fg">Carteira por consultor</h2>
      <p className="mt-0.5 text-xs text-fg-subtle">
        Quantos clientes de cada um precisam de atenção — não é ranking de
        produtividade.
      </p>
      <ul className="mt-4 space-y-2">
        {groups.map((g) => (
          <li
            key={g.name}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2"
          >
            <span className="text-sm font-medium text-fg">{g.name}</span>
            <div className="flex items-center gap-3 text-xs">
              <BandTally farol="verde" n={g.verde} />
              <BandTally farol="amarelo" n={g.amarelo} />
              <BandTally farol="vermelho" n={g.vermelho} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BandTally({ farol, n }: { farol: Farol; n: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${n === 0 ? "opacity-40" : ""}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${FAROL_UI[farol].dot}`} aria-hidden="true" />
      <span className="text-fg-muted">{FAROL_UI[farol].label}</span>
      <span className="font-semibold tabular-nums text-fg">{n}</span>
    </span>
  );
}

function EmptyCard({
  children,
  good,
}: {
  children: React.ReactNode;
  good?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-10 text-center shadow-card ${
        good
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          : "border-line bg-surface text-fg-subtle"
      }`}
    >
      {children}
    </div>
  );
}
