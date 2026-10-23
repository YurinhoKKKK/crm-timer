"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { avatarUrl } from "@/lib/avatar";
import ResponsibleChips from "@/components/ResponsibleChips";
import { SearchBox, FilterBar, ShowMore, usePaged, norm } from "@/components/ListControls";
import { type BoardRow, type DayColor, type MonthOption } from "@/lib/followup";
import { FAROL_UI } from "@/components/followup/FarolBadge";
import MonthSelect from "@/components/followup/MonthSelect";

// Preferência de ordem (pior/melhor primeiro) guardada por usuário.
const ORDER_KEY = "crm:acompanhamento:ordem";

const TZ = "America/Sao_Paulo";

// "DD/MM às HH:MM" (BRT) para um instante (última mensagem).
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

// "DD/MM/AAAA" (BRT) para reunião futura.
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Data pura YYYY-MM-DD → "sexta, 23/10". Sem fuso: parse por componentes.
function fmtRelevantDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long" });
  const short = dt.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
  return `${weekday}, ${short}`;
}

// A ordem PADRÃO vem pronta do banco (RPC followup_board): vermelho → amarelo →
// verde → aguardando; dentro da cor, há mais tempo sem mensagem primeiro ("pior
// primeiro"). O botão "Melhor primeiro" INVERTE a lista inteira (antes de
// filtrar e paginar — nunca reordenamos uma página isolada). Os chips de cor
// filtram por cima, preservando a ordem escolhida.

// Resumo do mês: contagem de dias por cor (os 'aguardando'/fins de semana não
// entram — só dias úteis já pontuados).
function periodSummary(r: BoardRow): string {
  const parts: string[] = [];
  if (r.daysVerde) parts.push(`${r.daysVerde} em dia`);
  if (r.daysAmarelo) parts.push(`${r.daysAmarelo} atenção`);
  if (r.daysVermelho) parts.push(`${r.daysVermelho} sem contato`);
  return parts.join(" · ");
}

export default function FollowupView({
  rows,
  role,
  error,
  month,
  monthOptions,
}: {
  rows: BoardRow[];
  role: "admin" | "consultor";
  error?: string | null;
  month: string;
  monthOptions: MonthOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [consultantId, setConsultantId] = useState("");
  const [color, setColor] = useState<DayColor | "">("");
  // true = "pior primeiro" (ordem do banco); false = "melhor primeiro"
  // (invertido). Inicia no padrão e lê a preferência salva ao montar (evita
  // divergência de hidratação).
  const [worstFirst, setWorstFirst] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(ORDER_KEY) === "melhor") setWorstFirst(false);
    } catch {
      /* localStorage indisponível — segue no padrão */
    }
  }, []);

  function toggleOrder() {
    setWorstFirst((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ORDER_KEY, next ? "pior" : "melhor");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Consultores presentes (filtro do admin). Ordem alfabética — neutra.
  const consultantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows)
      for (const c of r.consultants)
        if (!map.has(c.id)) map.set(c.id, c.name || "(sem nome)");
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR")
    );
  }, [rows]);

  // Recorte por consultor (só filtra; NÃO reordena por "melhor").
  const byConsultant = useMemo(
    () =>
      consultantId
        ? rows.filter((r) => r.consultants.some((c) => c.id === consultantId))
        : rows,
    [rows, consultantId]
  );

  // Busca por nome da empresa — COMPÕE com os filtros. Sem acentos, qualquer
  // trecho (os nomes começam com código interno).
  const base = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return byConsultant;
    return byConsultant.filter((r) => norm(r.companyName).includes(q));
  }, [byConsultant, query]);

  // Contagem por cor sobre o recorte já com consultor + busca (mas ignorando o
  // filtro de cor, para os números continuarem fazendo sentido).
  const bands = useMemo(() => {
    const b = { verde: 0, amarelo: 0, vermelho: 0, aguardando: 0 };
    for (const r of base) b[r.color] += 1;
    return b;
  }, [base]);

  // Ordem: padrão do banco ("pior primeiro") ou a lista TODA invertida ("melhor
  // primeiro"). Inverter aqui a lista inteira (antes de filtrar/paginar) mantém
  // a paginação correta — nunca reordenamos uma página isolada.
  const ordered = useMemo(
    () => (worstFirst ? base : [...base].reverse()),
    [base, worstFirst]
  );

  // Os chips de cor filtram por cima da ordem escolhida. A paginação corta DEPOIS.
  const filtered = useMemo(
    () => (color ? ordered.filter((r) => r.color === color) : ordered),
    [ordered, color]
  );

  const { visible, hasMore, remaining, showMore } = usePaged(filtered, 25);

  function setMonth(m: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mes", m);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const total = base.length;
  // 'aguardando' só aparece como chip quando há algum (dia útil em andamento).
  const colorBands: DayColor[] = ["verde", "amarelo", "vermelho"];
  if (bands.aguardando > 0) colorBands.push("aguardando");

  return (
    <div className="space-y-6">
      <FilterBar>
        <MonthSelect
          id="mes-acompanhamento"
          month={month}
          options={monthOptions}
          onChange={setMonth}
          ariaLabel="Mês do acompanhamento"
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar empresa…" />
        {role === "admin" && consultantOptions.length > 0 && (
          <select
            value={consultantId}
            onChange={(e) => setConsultantId(e.target.value)}
            aria-label="Filtrar por consultor responsável"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <option value="">Todos os consultores</option>
            {consultantOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {/* Alterna a ordem da lista inteira. A seta aponta para onde está o
            "pior" (para baixo = pior no topo; para cima = pior embaixo). */}
        <button
          type="button"
          onClick={toggleOrder}
          aria-label={worstFirst ? "Ordem: pior primeiro. Clique para inverter." : "Ordem: melhor primeiro. Clique para inverter."}
          title="Inverter a ordem"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition hover:border-risd/40 focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={worstFirst ? "" : "rotate-180"}>
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          <span className="whitespace-nowrap">{worstFirst ? "Pior primeiro" : "Melhor primeiro"}</span>
        </button>
      </FilterBar>

      {/* Cores do dia — também filtram a lista ao clicar. */}
      <div className="flex flex-wrap gap-2">
        <BandChip active={color === ""} onClick={() => setColor("")} label="Todos" count={total} />
        {colorBands.map((f) => (
          <BandChip
            key={f}
            active={color === f}
            onClick={() => setColor(color === f ? "" : f)}
            label={FAROL_UI[f].label}
            count={bands[f]}
            color={f}
          />
        ))}
        <p className="ml-auto self-center text-xs text-fg-subtle">
          Cor do dia pela 1ª mensagem: manhã = em dia · tarde = atenção · após 17h
          ou nenhuma = sem contato
        </p>
      </div>

      {error ? (
        <ErrorCard>
          Não foi possível carregar o acompanhamento. Tente recarregar a página;
          se persistir, avise o suporte.
        </ErrorCard>
      ) : rows.length === 0 ? (
        <EmptyCard>Nenhuma empresa de grupo ativo para acompanhar.</EmptyCard>
      ) : filtered.length === 0 ? (
        <EmptyCard good={!query}>
          {query
            ? `Nenhuma empresa corresponde a “${query.trim()}” neste recorte.`
            : color === "verde"
            ? "Nenhum cliente em dia neste recorte."
            : color === "amarelo"
            ? "Nenhum cliente na faixa de atenção."
            : color === "vermelho"
            ? "Boa notícia: nenhum cliente sem contato hoje. 🎉"
            : "Nenhum cliente neste recorte."}
        </EmptyCard>
      ) : (
        <>
          <ul className="space-y-2.5">
            {visible.map((r) => (
              <CompanyRow key={r.companyId} row={r} role={role} />
            ))}
          </ul>
          {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}
        </>
      )}

      {role === "admin" && <ConsultantBreakdown rows={rows} />}
    </div>
  );
}

function BandChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: DayColor;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
        active ? "border-risd/50 bg-brand-tint text-fg" : "border-line bg-surface text-fg-muted hover:text-fg"
      }`}
    >
      {color && <span className={`h-2.5 w-2.5 rounded-full ${FAROL_UI[color].dot}`} />}
      {label}
      <span className="tabular-nums text-fg-subtle">{count}</span>
    </button>
  );
}

function CompanyRow({ row, role }: { row: BoardRow; role: "admin" | "consultor" }) {
  const ui = FAROL_UI[row.color];
  const href =
    role === "admin" ? `/admin/empresas/${row.companyId}` : `/consultor/${row.companyId}`;
  const summary = periodSummary(row);

  return (
    <li>
      <Link
        href={href}
        className="group flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-risd/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <span className={`mt-0.5 w-1.5 shrink-0 self-stretch rounded-full ${ui.dot}`} aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-fg group-hover:text-risd">{row.companyName}</span>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ui.chip}`}
              >
                <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
                {ui.label}
              </span>
              {/* Fim de semana/feriado: a cor é a do último dia útil — mostramos
                  qual dia para não confundir com "hoje". */}
              {!row.isToday && (
                <span className="text-xs text-fg-subtle">
                  cor de <span className="tabular-nums">{fmtRelevantDay(row.relevantDay)}</span>
                </span>
              )}
            </span>
          </div>

          {/* Responsáveis: consultores + colaboradores, no componente único. */}
          <ResponsibleChips
            consultants={row.consultants.map((c) => ({
              id: c.id,
              name: c.name || "(sem nome)",
              avatarUrl: avatarUrl(c.avatarPath),
            }))}
            collaborators={row.collaborators.map((c) => ({
              id: c.id,
              name: c.name || "(sem nome)",
              avatarUrl: avatarUrl(c.avatarPath),
            }))}
            className="mt-2"
          />

          {/* Última mensagem válida (qualquer data) + resumo de dias no período. */}
          <p className="mt-2 text-sm text-fg-muted">
            {row.lastMsgAt ? (
              <>
                Última mensagem:{" "}
                <span className="tabular-nums text-fg">{fmtDateTime(row.lastMsgAt)}</span>
              </>
            ) : (
              <span className={ui.text}>Sem contato no Digisac</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {summary ? summary : "Sem dias pontuados no período"}
          </p>

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

// Recorte por consultor: quantos clientes DELE em cada cor (dia relevante).
// Ordem alfabética, sem pódio — é carteira precisando de atenção, não ranking.
function ConsultantBreakdown({ rows }: { rows: BoardRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { name: string; verde: number; amarelo: number; vermelho: number; aguardando: number }
    >();
    const bump = (id: string, name: string, f: DayColor) => {
      const g = map.get(id) ?? { name, verde: 0, amarelo: 0, vermelho: 0, aguardando: 0 };
      g[f] += 1;
      map.set(id, g);
    };
    for (const r of rows) {
      if (r.consultants.length === 0) bump("__none__", "Sem responsável", r.color);
      else for (const c of r.consultants) bump(c.id, c.name || "(sem nome)", r.color);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [rows]);

  if (groups.length === 0) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold text-fg">Carteira por consultor</h2>
      <p className="mt-0.5 text-xs text-fg-subtle">
        Quantos clientes de cada um precisam de atenção hoje — não é ranking de
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
              <BandTally color="verde" n={g.verde} />
              <BandTally color="amarelo" n={g.amarelo} />
              <BandTally color="vermelho" n={g.vermelho} />
              {g.aguardando > 0 && <BandTally color="aguardando" n={g.aguardando} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BandTally({ color, n }: { color: DayColor; n: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${n === 0 ? "opacity-40" : ""}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${FAROL_UI[color].dot}`} aria-hidden="true" />
      <span className="text-fg-muted">{FAROL_UI[color].label}</span>
      <span className="font-semibold tabular-nums text-fg">{n}</span>
    </span>
  );
}

// Erro de carregamento NUNCA vira lista vazia silenciosa — aviso explícito; o
// servidor loga o erro real (loadFollowupBoard).
function ErrorCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-red-300/60 bg-red-50 p-8 text-center text-sm text-red-700 shadow-card dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      {children}
    </div>
  );
}

function EmptyCard({ children, good }: { children: React.ReactNode; good?: boolean }) {
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
