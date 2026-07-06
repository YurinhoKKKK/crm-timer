"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { STATUS_META } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import type { Period } from "./PeriodFilter";
import {
  getCompanyTimeBreakdown,
  type BreakdownTask,
} from "./chart-actions";

export type CompanyTime = {
  name: string;
  seconds: number;
  id?: string; // presente no dashboard, habilita o detalhamento ao clicar
};

// Tooltip: minutos quando < 1h, horas com 1 casa quando >= 1h.
function formatSmart(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// Encurta um rótulo com reticências (o nome completo fica no tooltip / no
// <title> do próprio rótulo).
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

// Largura real do contêiner (via ResizeObserver), para calcular quantos rótulos
// cabem e o tamanho de cada um sem colisão — inclusive no celular.
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
  id: string;
  name: string;
  barSeconds: number;
};

// Painel lateral com as tarefas que compõem o tempo de uma empresa (Passo 17).
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
    getCompanyTimeBreakdown(selected.id, period, collaboratorId).then((res) => {
      if (!active) return;
      if (res.error) {
        setError(res.error);
      } else {
        setTasks(res.tasks ?? []);
        setTotal(res.totalSeconds ?? 0);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [selected.id, period, collaboratorId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal para o <body>: o <main> tem `transform` (animate-fade-in), o que o
  // tornaria o containing block deste painel `fixed` e o ancoraria ao topo do
  // conteúdo (cortado quando a página está rolada). No body, o `fixed` ancora
  // na viewport e o painel abre inteiro, com rolagem interna própria.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhamento de tempo — ${selected.name}`}
        className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-surface shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              Tempo por empresa
            </p>
            <h2 className="truncate text-lg font-semibold text-fg">
              {selected.name}
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
            <p className="py-8 text-center text-sm text-fg-subtle">
              Carregando…
            </p>
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
                  <li
                    key={t.id}
                    className="rounded-xl border border-line bg-surface p-3"
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
                          <span>{t.collaboratorName}</span>
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

export default function TimeByCompanyChart({
  data,
  drilldownPeriod,
  drilldownCollaboratorId,
  topN = 8,
}: {
  data: CompanyTime[];
  // Quando definido, as barras ficam clicáveis e abrem o detalhamento por
  // empresa. Usado no dashboard e na página do colaborador.
  drilldownPeriod?: Period;
  // Escopa o detalhamento a um responsável (página do colaborador), para o
  // painel refletir só o tempo dele naquela empresa.
  drilldownCollaboratorId?: string;
  // Quantas empresas exibir como barras próprias antes de agrupar a cauda em
  // "Outras" (Passo 18 — escala). Recebe a lista COMPLETA e agrupa aqui.
  topN?: number;
}) {
  const dark = useIsDark();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [showAll, setShowAll] = useState(false);

  const clickable = !!drilldownPeriod && data.some((d) => d.id);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-fg-subtle">
        Nenhum tempo registrado no período.
      </div>
    );
  }

  const grid = dark ? "#2A313A" : "#E4E2DF";
  const axis = dark ? "#9AA2AC" : "#5B636C";
  const cursor = dark ? "rgba(255,255,255,0.05)" : "#F0F0EE";
  const othersFill = dark ? "#4B535C" : "#B8BEC5";

  // Ordena por tempo (desc) e, com muitas empresas, agrupa a cauda numa barra
  // "Outras" para o gráfico ficar legível — sem esconder tempo (a soma bate).
  // A alternância "ver todas" reexpande; a barra "Outras" também expande ao ser
  // clicada. "Outras" não tem id → não abre o detalhamento por empresa.
  const sorted = [...data].sort((a, b) => b.seconds - a.seconds);
  const overflow = sorted.length > topN;
  const source =
    overflow && !showAll
      ? [
          ...sorted.slice(0, topN),
          {
            name: `Outras (${sorted.length - topN})`,
            seconds: sorted
              .slice(topN)
              .reduce((s, d) => s + d.seconds, 0),
            isOthers: true as const,
          },
        ]
      : sorted;

  // Escolhe a unidade do eixo conforme o maior valor da série: quando ninguém
  // passa de 1h, o eixo fica em minutos (evita ticks como 0.03h).
  const maxSeconds = source.reduce((m, d) => Math.max(m, d.seconds), 0);
  const useHours = maxSeconds >= 3600;
  const divisor = useHours ? 3600 : 60;

  const chartData = source.map((d) => ({
    name: d.name,
    value: d.seconds / divisor,
    seconds: d.seconds,
    id: "id" in d ? d.id : undefined,
    isOthers: "isOthers" in d,
  }));

  const formatTick = (v: number): string => {
    if (useHours) return v % 1 === 0 ? String(v) : v.toFixed(1);
    return String(Math.round(v));
  };

  function handleSelect(entry: (typeof chartData)[number]) {
    // Clicar em "Outras" reexpande a lista completa em vez de detalhar.
    if (entry.isOthers) {
      setShowAll(true);
      return;
    }
    if (!clickable || !entry.id) return;
    setSelected({ id: entry.id, name: entry.name, barSeconds: entry.seconds });
  }

  // Layout dos rótulos do eixo X, a partir da largura REAL medida: (1) trunca
  // cada nome ao que cabe numa "faixa" e (2) pula rótulos quando há barras
  // demais para caberem sem colidir. As barras continuam todas; só os rótulos
  // são ralados. O nome completo fica no tooltip e no <title> do rótulo.
  const count = chartData.length;
  const effWidth = width || 640; // fallback antes da 1ª medição
  const MIN_LABEL_PX = 58; // espaço horizontal mínimo por rótulo inclinado
  const maxLabels = Math.max(1, Math.floor(effWidth / MIN_LABEL_PX));
  const labelInterval = count <= maxLabels ? 0 : Math.ceil(count / maxLabels) - 1;
  const shownLabels = Math.ceil(count / (labelInterval + 1));
  const bandPx = effWidth / shownLabels;
  const LABEL_ANGLE = -35;
  const maxChars = Math.min(26, Math.max(6, Math.floor(bandPx / 6.2)));
  // Reserva vertical na base, proporcional ao maior rótulo inclinado.
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

  return (
    <>
      {/* outline-none nos descendentes: ao clicar, os <rect>/<path> do recharts
          recebem :focus e o navegador desenha um contorno (os "quadriculados
          brancos" em posições estranhas). Suprimimos esse foco visual. */}
      <div
        ref={wrapRef}
        style={{ height: 220 + axisHeight }}
        className="w-full [&_*:focus]:outline-none [&_svg]:outline-none"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
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
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--fg)",
                fontSize: 12,
                boxShadow: "var(--shadow-pop)",
              }}
              labelStyle={{ color: "var(--fg)", fontWeight: 600 }}
              itemStyle={{ color: "var(--fg-muted)" }}
              formatter={(_value, _name, item) => [
                formatSmart((item?.payload as { seconds: number }).seconds),
                "Tempo",
              ]}
            />
            <Bar
              dataKey="value"
              radius={[6, 6, 0, 0]}
              maxBarSize={56}
              // Evita a barra "ativa" que o recharts sobrepõe ao clicar/focar.
              activeBar={false}
              cursor={clickable || overflow ? "pointer" : undefined}
              onClick={(entry) => {
                const payload = (
                  entry as unknown as {
                    payload?: (typeof chartData)[number];
                  }
                ).payload;
                if (payload) handleSelect(payload);
              }}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.isOthers ? othersFill : "#3145FF"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-col items-center gap-1">
        {clickable && (
          <p className="text-center text-xs text-fg-subtle">
            Clique numa barra para ver as tarefas que compõem o tempo.
          </p>
        )}
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

      {selected && drilldownPeriod && (
        <BreakdownPanel
          selected={selected}
          period={drilldownPeriod}
          collaboratorId={drilldownCollaboratorId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
