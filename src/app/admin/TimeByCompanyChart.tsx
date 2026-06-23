"use client";

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

export default function TimeByCompanyChart({ data }: { data: CompanyTime[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gunmetal/40">
        Nenhum tempo registrado no período.
      </div>
    );
  }

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
          <CartesianGrid strokeDasharray="3 3" stroke="#DFDCDB" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "#2B333B", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "#DFDCDB" }}
            interval={0}
            angle={chartData.length > 4 ? -20 : 0}
            textAnchor={chartData.length > 4 ? "end" : "middle"}
            height={chartData.length > 4 ? 56 : 32}
          />
          <YAxis
            tick={{ fill: "#2B333B", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{
              value: "horas",
              angle: -90,
              position: "insideLeft",
              fill: "#2B333B99",
              fontSize: 11,
            }}
          />
          <Tooltip
            cursor={{ fill: "#F5F5F4" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #DFDCDB",
              fontSize: 12,
            }}
            formatter={(_value, _name, item) => [
              formatHours((item?.payload as { seconds: number }).seconds),
              "Tempo",
            ]}
          />
          <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={56}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill="#3145FF" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
