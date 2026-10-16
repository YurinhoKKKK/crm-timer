"use client";

import dynamic from "next/dynamic";
import type { CompanyCategoryTime } from "./CategoryTimeByCompanyChart";

// Carrega o gráfico (recharts) SÓ no cliente e sob demanda — tira o recharts do
// First Load JS das rotas de dashboard (mesmo padrão do RevenueChart). Como as
// páginas que o usam são Server Components (onde `ssr: false` não é permitido),
// este wrapper client é o ponto onde o dynamic/ssr:false pode viver.
//
// O placeholder reserva ~a altura do gráfico (corpo 220 + eixo ~80) para a tela
// não pular enquanto o chunk carrega.
const Chart = dynamic(() => import("./CategoryTimeByCompanyChart"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full rounded-2xl border border-line bg-surface shadow-card"
      style={{ height: 300 }}
      aria-hidden="true"
    />
  ),
});

type Props = {
  data: CompanyCategoryTime[];
  dataWithStandard?: CompanyCategoryTime[];
  start: string | null;
  end: string | null;
  collaboratorId?: string;
  topN?: number;
};

export default function CategoryTimeByCompanyChartLazy(props: Props) {
  return <Chart {...props} />;
}
