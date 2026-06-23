"use client";

import { useEffect, useState } from "react";
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

export type CompanyTime = {
  name: string;
  seconds: number;
};

function formatHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0min";
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
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

export default function TimeByCompanyChart({ data }: { data: CompanyTime[] }) {
  const dark = useIsDark();

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

  const chartData = data.map((d) => ({
    name: d.name,
    hours: Number((d.seconds / 3600).toFixed(2)),
    seconds: d.seconds,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: axis, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: grid }}
            interval={0}
            angle={chartData.length > 4 ? -20 : 0}
            textAnchor={chartData.length > 4 ? "end" : "middle"}
            height={chartData.length > 4 ? 56 : 32}
          />
          <YAxis
            tick={{ fill: axis, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{
              value: "horas",
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
              formatHours((item?.payload as { seconds: number }).seconds),
              "Tempo",
            ]}
          />
          <Bar dataKey="hours" radius={[6, 6, 0, 0]} maxBarSize={56}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill="#3145FF" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
