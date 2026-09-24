"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { STATUS_META } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import Person from "@/components/Person";
import TaskDetailLink from "@/components/TaskDetailLink";
import {
  categoryColor,
  categoryLabel,
  CATEGORY_ORDER,
} from "@/lib/task-category";
import type { Period } from "./PeriodFilter";
import { getCompanyTimeBreakdown, type BreakdownTask } from "./chart-actions";

// Tempo de UMA empresa quebrado por categoria (reforma do cadastro). `total` é a
// soma das categorias — só entram tarefas categorizadas (+ listagem, agrupada
// por template_type). O detalhamento por título aparece só ao clicar.
export type CompanyCategoryTime = {
  id: string;
  name: string;
  total: number;
  byCategory: { category: string; seconds: number }[];
};

const OUTRAS_KEY = "__outras__";

// Tooltip: minutos quando < 1h, horas com 1 casa quando >= 1h.
function formatSmart(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

// Largura real do contêiner (via ResizeObserver), para dosar os rótulos do eixo.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, width] as const;
}

// Observa a classe `dark` no <html> para recolorir o gráfico ao trocar de tema.
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

type Selected = {
  companyId: string;
  companyName: string;
  // Ausente = empresa inteira (todas as tarefas). Presente = só aquela categoria.
  category?: string;
};

// Painel lateral: as tarefas que compõem o tempo — da empresa inteira (clique no
// corpo da coluna) ou de uma categoria (clique numa faixa). z-overlay (50); o
// detalhe da tarefa (TaskDetailLink) abre por cima em z-sheet (60).
function BreakdownPanel({
  selected,
  period,
  collaboratorId,
  onClose,
}: {
  selected: Selected;
  period: Period;
  collaboratorId?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<BreakdownTask[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getCompanyTimeBreakdown(
      selected.companyId,
      period,
      collaboratorId,
      selected.category
    ).then((res) => {
      if (!active) return;
      if (res.error) setError(res.error);
      else {
        setTasks(res.tasks ?? []);
        setTotal(res.totalSeconds ?? 0);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [selected.companyId, selected.category, period, collaboratorId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const heading = selected.category
    ? categoryLabel(selected.category)
    : "Tempo por empresa";

  return createPortal(
    <div className="fixed inset-0 z-overlay flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Tarefas — ${selected.companyName}`}
        className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-surface shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              {heading}
            </p>
            <h2 className="truncate text-lg font-semibold text-fg">
              {selected.companyName}
            </h2>
            <p className="mt-1 font-mono text-sm tabular-nums text-risd">
              {formatDuration(total)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-subtle">
              Nenhuma tarefa com tempo registrado no período.
            </p>
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => {
                const meta = STATUS_META[t.status];
                const share =
                  total > 0 ? Math.round((t.seconds / total) * 100) : 0;
                return (
                  <li key={t.id}>
                    <TaskDetailLink
                      taskId={t.id}
                      className="block w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">
                            {t.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${meta.badge}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                              />
                              {meta.label}
                            </span>
                            <Person
                              name={t.collaboratorName}
                              avatarUrl={t.collaboratorAvatarUrl}
                              size={16}
                            />
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                          {formatDuration(t.seconds)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-risd"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </TaskDetailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

type Row = {
  name: string;
  id?: string;
  isOthers: boolean;
  total: number; // segundos (para o tooltip)
  sec: Record<string, number>; // segundos por categoria (para o tooltip)
  [key: string]: number | string | boolean | Record<string, number> | undefined;
};

export default function CategoryTimeByCompanyChart({
  data,
  period,
  collaboratorId,
  topN = 8,
}: {
  data: CompanyCategoryTime[];
  period: Period;
  collaboratorId?: string;
  topN?: number;
}) {
  const dark = useIsDark();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Guarda para não abrir DUAS vezes ao clicar numa faixa: o onClick da faixa
  // (categoria) roda antes do onClick da coluna; marcamos aqui para o da coluna
  // se abster.
  const segmentClicked = useRef(false);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-fg-subtle">
        Nenhum tempo registrado no período.
      </div>
    );
  }

  const grid = dark ? "#2A313A" : "#E4E2DF";
  const axis = dark ? "#9AA2AC" : "#5B636C";
  const cursor = dark ? "rgba(120,140,255,0.14)" : "rgba(49,69,255,0.08)";
  const othersFill = dark ? "#4B535C" : "#B8BEC5";

  // Categorias presentes, na ordem canônica — definem as séries empilhadas e a
  // legenda.
  const present = Array.from(
    new Set(data.flatMap((d) => d.byCategory.map((c) => c.category)))
  ).sort((a, b) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99));

  // Ordena por tempo (desc) e, com muitas empresas, agrupa a cauda numa barra
  // "Outras" (sem quebra por categoria — clicar nela reexpande).
  const sorted = [...data].sort((a, b) => b.total - a.total);
  const overflow = sorted.length > topN;
  const head = overflow && !showAll ? sorted.slice(0, topN) : sorted;
  const tail = overflow && !showAll ? sorted.slice(topN) : [];

  // Unidade do eixo conforme o maior total.
  const maxSeconds = head.reduce(
    (m, d) => Math.max(m, d.total),
    tail.reduce((s, d) => s + d.total, 0)
  );
  const useHours = maxSeconds >= 3600;
  const divisor = useHours ? 3600 : 60;

  const chartData: Row[] = head.map((company) => {
    const sec: Record<string, number> = {};
    const row: Row = {
      name: company.name,
      id: company.id,
      isOthers: false,
      total: company.total,
      sec,
    };
    for (const c of company.byCategory) {
      sec[c.category] = c.seconds;
      row[c.category] = c.seconds / divisor; // altura da faixa (unidade do eixo)
    }
    return row;
  });
  if (tail.length > 0) {
    const tailTotal = tail.reduce((s, d) => s + d.total, 0);
    chartData.push({
      name: `Outras (${tail.length})`,
      isOthers: true,
      total: tailTotal,
      sec: {},
      [OUTRAS_KEY]: tailTotal / divisor,
    });
  }

  const formatTick = (v: number): string => {
    if (useHours) return v % 1 === 0 ? String(v) : v.toFixed(1);
    return String(Math.round(v));
  };

  function openWholeCompany(row: Row) {
    if (row.isOthers) {
      setShowAll(true);
      return;
    }
    if (!row.id) return;
    setSelected({ companyId: row.id, companyName: row.name });
  }

  function openCategory(row: Row, category: string) {
    if (!row.id) return;
    segmentClicked.current = true;
    setSelected({
      companyId: row.id,
      companyName: row.name,
      category,
    });
  }

  // Clique na COLUNA (qualquer altura, do topo à base): resolve a empresa sob o
  // cursor. Se o clique foi numa faixa de categoria, o handler da faixa já
  // tratou — este se abstém.
  function handleColumnClick(state: unknown) {
    if (segmentClicked.current) {
      segmentClicked.current = false;
      return;
    }
    const s = state as {
      activeTooltipIndex?: number | string | null;
      activeIndex?: number | string | null;
      activeLabel?: string | number | null;
    };
    const raw = s.activeTooltipIndex ?? s.activeIndex;
    let row: Row | undefined;
    if (raw != null && raw !== "") {
      const idx = Number(raw);
      if (Number.isInteger(idx) && idx >= 0 && idx < chartData.length) {
        row = chartData[idx];
      }
    }
    if (!row && s.activeLabel != null) {
      row = chartData.find((d) => d.name === s.activeLabel);
    }
    if (row) openWholeCompany(row);
  }

  // Layout dos rótulos do eixo X (igual ao gráfico anterior): trunca ao que cabe
  // numa "faixa" e rala rótulos quando há barras demais. As barras continuam
  // todas; o nome completo fica no tooltip e no <title> do rótulo.
  const count = chartData.length;
  const effWidth = width || 640;
  const MIN_LABEL_PX = 58;
  const maxLabels = Math.max(1, Math.floor(effWidth / MIN_LABEL_PX));
  const labelInterval = count <= maxLabels ? 0 : Math.ceil(count / maxLabels) - 1;
  const shownLabels = Math.ceil(count / (labelInterval + 1));
  const bandPx = effWidth / shownLabels;
  const LABEL_ANGLE = -35;
  const maxChars = Math.min(26, Math.max(6, Math.floor(bandPx / 6.2)));
  const axisHeight = Math.min(
    116,
    Math.max(
      40,
      Math.round(maxChars * 6.2 * Math.sin((-LABEL_ANGLE * Math.PI) / 180)) + 20
    )
  );

  function renderAxisTick(props: {
    x?: number | string;
    y?: number | string;
    payload?: { value?: string | number };
  }) {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const full = String(props.payload?.value ?? "");
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          dy={12}
          textAnchor="end"
          transform={`rotate(${LABEL_ANGLE})`}
          fill={axis}
          fontSize={12}
        >
          <title>{full}</title>
          {truncate(full, maxChars)}
        </text>
      </g>
    );
  }

  // Tooltip: quebra por categoria da empresa sob o cursor + total. Tipo mínimo
  // local (o recharts injeta active/payload); a prop `content` é casada com o
  // tipo exato aceito pelo componente no uso, evitando atrito com os genéricos.
  function renderTooltip({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { payload?: Row }[];
  }) {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const parts = present
      .filter((cat) => (row.sec[cat] ?? 0) > 0)
      .map((cat) => ({ cat, seconds: row.sec[cat] }));
    return (
      <div
        className="rounded-xl border border-line bg-surface p-3 text-xs shadow-pop"
        style={{ color: "var(--fg)" }}
      >
        <p className="mb-1 font-semibold text-fg">{row.name}</p>
        {row.isOthers ? (
          <p className="text-fg-muted">{formatSmart(row.total)}</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {parts.map((p) => (
                <li key={p.cat} className="flex items-center gap-1.5 text-fg-muted">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-sm"
                    style={{ background: categoryColor(p.cat, dark) }}
                  />
                  <span className="text-fg">{categoryLabel(p.cat)}</span>
                  <span className="ml-auto tabular-nums">
                    {formatSmart(p.seconds)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 flex items-center justify-between border-t border-line pt-1 font-medium text-fg">
              <span>Total</span>
              <span className="tabular-nums">{formatSmart(row.total)}</span>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Legenda das categorias (nome escrito). */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {present.map((cat) => (
          <span
            key={cat}
            className="inline-flex items-center gap-1.5 text-xs text-fg-muted"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: categoryColor(cat, dark) }}
            />
            {categoryLabel(cat)}
          </span>
        ))}
      </div>

      <div
        ref={wrapRef}
        style={{ height: 220 + axisHeight }}
        className="w-full [&_*:focus]:outline-none [&_svg]:outline-none [&_.recharts-wrapper]:cursor-pointer"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
            // Alvo de clique = COLUNA INTEIRA (do topo à base). O recharts
            // resolve a empresa sob o cursor em qualquer altura.
            onClick={handleColumnClick}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis
              dataKey="name"
              tick={renderAxisTick}
              tickLine={false}
              axisLine={{ stroke: grid }}
              interval={labelInterval}
              height={axisHeight}
            />
            <YAxis
              tick={{ fill: axis, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={formatTick}
              label={{
                value: useHours ? "horas" : "minutos",
                angle: -90,
                position: "insideLeft",
                fill: axis,
                fontSize: 11,
              }}
            />
            <Tooltip
              cursor={{ fill: cursor }}
              content={
                renderTooltip as unknown as ComponentProps<
                  typeof Tooltip
                >["content"]
              }
            />
            {/* Uma série por categoria, empilhada. Clicar numa faixa abre as
                tarefas daquela categoria (marca o guard p/ a coluna se abster). */}
            {present.map((cat, i) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="a"
                fill={categoryColor(cat, dark)}
                activeBar={false}
                cursor="pointer"
                // Canto arredondado só no topo da última série (aparência do
                // gráfico original).
                radius={i === present.length - 1 ? [4, 4, 0, 0] : undefined}
                onClick={(entry: unknown) => {
                  const p = (entry as { payload?: Row } | undefined)?.payload;
                  if (p) openCategory(p, cat);
                }}
              />
            ))}
            {tail.length > 0 && (
              <Bar
                dataKey={OUTRAS_KEY}
                stackId="a"
                fill={othersFill}
                activeBar={false}
                cursor="pointer"
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-col items-center gap-1">
        <p className="text-center text-xs text-fg-subtle">
          Clique numa coluna para ver as tarefas que compõem o tempo.
        </p>
        {overflow && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            {showAll
              ? `Agrupar as menores (Top ${topN})`
              : `Ver todas as ${sorted.length} empresas`}
          </button>
        )}
      </div>

      {selected && (
        <BreakdownPanel
          selected={selected}
          period={period}
          collaboratorId={collaboratorId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
