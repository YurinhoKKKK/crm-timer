"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHANNEL_LINE_COLOR,
  CHANNEL_LABEL,
  buildRevenueSeries,
  channelsWithHistory,
  currentMonthValues,
  formatBRL,
  monthLabel,
  type RevenueOverview,
  type SalesChannel,
} from "@/lib/revenue";

// Observa a classe `dark` no <html> para recolorir o gráfico ao trocar de tema
// (mesmo padrão do TimeByCompanyChart).
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

const compactBRL = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Progressão do faturamento por canal + total ao longo dos meses (Fatia 2).
// Correções: (1.1) reta entre pontos (type="linear", sem suavização que
// desenharia valores intermediários inexistentes); (1.2) uma linha para todo
// canal com histórico no intervalo (ativo ou não), não só os ativos; (1.3) o
// mês corrente é parcial e NÃO liga ao mês anterior — a série principal
// interrompe antes dele e o valor é desenhado como PONTO SOLTO (ReferenceDot
// vazado), para o olho não ler uma queda falsa pela inclinação.
export default function RevenueChart({
  overview,
}: {
  overview: RevenueOverview;
}) {
  const dark = useIsDark();

  const data = buildRevenueSeries(overview.months, overview.currentMonth);
  // 1.2 — canais com pelo menos um lançamento no intervalo (não os "ativos").
  const channels = channelsWithHistory(overview.months);

  const grid = dark ? "#2A313A" : "#E4E2DF";
  const axis = dark ? "#9AA2AC" : "#5B636C";
  const totalColor = dark ? "#E7E9EC" : "#2B333B";
  // Fundo dos pontos vazados (parcial) — aproxima a cor da superfície do card.
  const dotFill = dark ? "#12161B" : "#FFFFFF";

  const currentPoint = data.find((d) => d.isCurrent);
  const currentLabel = currentPoint?.label;
  const current = currentMonthValues(overview.months, overview.currentMonth);

  // Cada canal na variante do tema atual; o Total é sempre a cor neutra.
  const channelColor = (ch: SalesChannel) =>
    dark ? CHANNEL_LINE_COLOR[ch].dark : CHANNEL_LINE_COLOR[ch].light;
  const colorOf = (key: "total" | SalesChannel) =>
    key === "total" ? totalColor : channelColor(key);

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Progressão por canal</h3>
        <p className="text-xs text-fg-subtle">
          Meses sem registro ficam em branco na linha.
        </p>
      </div>
      <div className="h-72 w-full [&_*:focus]:outline-none [&_svg]:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: axis, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: grid }}
            />
            <YAxis
              tick={{ fill: axis, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(v: number) => `R$ ${compactBRL.format(v)}`}
            />
            <Tooltip
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
              formatter={(value, name) => [formatBRL(Number(value)), String(name)]}
            />
            {/* O traço da legenda leva a cor da marca (identificação), mas o
                TEXTO fica na cor de texto do tema: cor nunca é o único sinal e o
                rótulo mantém contraste próprio mesmo quando a linha é clara. */}
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="plainline"
              formatter={(value) => (
                <span style={{ color: "var(--fg)" }}>{value}</span>
              )}
            />

            {/* Mês corrente = parcial: linha vertical tracejada distinta. */}
            {currentLabel && (
              <ReferenceLine
                x={currentLabel}
                stroke={axis}
                strokeDasharray="4 4"
              />
            )}

            {/* 1.1 type="linear": reta entre pontos, sem arqueamento. */}
            <Line
              type="linear"
              dataKey="total"
              name="Total"
              stroke={totalColor}
              strokeWidth={2.5}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
            {channels.map((ch: SalesChannel) => (
              <Line
                key={ch}
                type="linear"
                dataKey={ch}
                name={CHANNEL_LABEL[ch]}
                stroke={channelColor(ch)}
                strokeWidth={1.75}
                dot={{ r: 2 }}
                activeDot={{ r: 3.5 }}
                connectNulls={false}
              />
            ))}

            {/* 1.3 mês corrente desenhado SOLTO (vazado), sem segmento ligando
                ao mês anterior — total e cada canal. */}
            {currentLabel && current && (
              <>
                <ReferenceDot
                  x={currentLabel}
                  y={current.total}
                  r={4.5}
                  fill={dotFill}
                  stroke={colorOf("total")}
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
                {channels.map((ch) =>
                  current.channels[ch] === undefined ? null : (
                    <ReferenceDot
                      key={`cur-${ch}`}
                      x={currentLabel}
                      y={current.channels[ch]!}
                      r={4}
                      fill={dotFill}
                      stroke={colorOf(ch)}
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                    />
                  )
                )}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Explicação do parcial junto da legenda. */}
      {current && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          {monthLabel(overview.currentMonth)}: mês em andamento (parcial), fora da
          linha por ser incompleto.
        </p>
      )}
    </div>
  );
}
