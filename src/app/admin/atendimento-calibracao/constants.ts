// Constantes compartilhadas da Calibração. Mora num módulo NEUTRO (sem "use
// client") de propósito: a tela (page.tsx, server) e a visão (CalibrationView,
// client) precisam do MESMO valor. Se este const morasse no componente client,
// o server receberia um placeholder de referência ({}) em vez da string — o que
// quebrava o período ("invalid input syntax for type date").

import type { PeriodConfig } from "@/lib/period";

export const CALIB_START = "2026-10-14"; // início da calibração

// Config do PeriodPicker da Calibração: Ontem/Hoje na barra + 7d/30d/Este mês/Mês
// passado e "Desde o início" (do CALIB_START até hoje) no popover; este último é o
// padrão quando a URL vem vazia. SEM "Tudo": os dados de calibração só existem a
// partir do CALIB_START e as RPCs esperam datas (um start/end nulo não faz sentido
// aqui). Compartilhado pela tela, pela visão (client) e pela rota de export.
export const CALIBRATION_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: ["ontem", "hoje"],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado", "calib_start"],
  default: "calib_start",
  calibStart: CALIB_START,
};
