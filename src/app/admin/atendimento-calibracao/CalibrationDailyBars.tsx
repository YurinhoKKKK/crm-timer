"use client";

import type { ComponentProps } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Gráfico de barras (recharts) do bloco "Por dia" da calibração, isolado num
// componente próprio para ser carregado via next/dynamic (ssr:false) pela
// CalibrationView — assim o recharts fica FORA do First Load JS da rota de
// calibração. Recebe os dados já agregados e o tema.

export type DailyDatum = { label: string; key: string; cron: number; est: number };

const num = (v: number | null | undefined) => Number(v) || 0;

// "1h14" / "45 min" / "—" (nunca decimal) — mesmo formato da CalibrationView.
function fmtMin(min: number): string {
  const m = Math.round(num(min));
  if (m <= 0) return "—";
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
}

export default function CalibrationDailyBars({
  data,
  dark,
}: {
  data: DailyDatum[];
  dark: boolean;
}) {
  const grid = dark ? "#2A313A" : "#E4E2DF";
  const axis = dark ? "#9AA2AC" : "#5B636C";

  function tooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const cron = payload.find((p) => p.dataKey === "cron")?.value ?? 0;
    const est = payload.find((p) => p.dataKey === "est")?.value ?? 0;
    return (
      <div className="rounded-xl border border-line bg-surface p-3 text-xs shadow-pop">
        <p className="mb-1 font-semibold text-fg">{label}</p>
        <p className="text-fg-muted">Cronometrado: <span className="tabular-nums text-fg">{fmtMin(cron)}</span></p>
        <p className="text-fg-muted">Estimado fora de tarefa: <span className="tabular-nums text-fg">{fmtMin(est)}</span></p>
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: grid }} />
          <YAxis tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} width={40}
            label={{ value: "minutos", angle: -90, position: "insideLeft", fill: axis, fontSize: 11 }} />
          <Tooltip cursor={{ fill: dark ? "rgba(120,140,255,0.14)" : "rgba(49,69,255,0.08)" }}
            content={tooltip as unknown as ComponentProps<typeof Tooltip>["content"]} />
          <Bar dataKey="cron" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
          <Bar dataKey="est" fill="#4f46e5" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
