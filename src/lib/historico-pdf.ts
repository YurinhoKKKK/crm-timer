import type { PeriodConfig } from "@/lib/period";

// Config do seletor de período do modal "Exportar PDF" do Histórico. É o
// PeriodPicker PADRÃO do sistema, com os mesmos atalhos do Histórico/Central,
// mas com params PRÓPRIOS (x*) para não atropelar os outros seletores que já
// vivem na URL da página da empresa (periodo/de/ate do topo, h* do feed, fat*).
// Padrão = "Tudo" (exportar o histórico inteiro).
//
// Este módulo é leve de propósito (só tipos de period.ts): é importado tanto
// pelo componente cliente do modal quanto pela rota de geração — nenhum dos
// dois arrasta o @react-pdf/renderer nem o parser de HTML.

export const EXPORT_PERIOD_CONFIG: PeriodConfig = {
  barShortcuts: ["ontem", "hoje", "tudo"],
  popoverShortcuts: ["7d", "30d", "este_mes", "mes_passado"],
  default: "tudo",
  params: { periodo: "xperiodo", de: "xde", ate: "xate", mes: "xmes" },
};

// Nomes dos params na URL do seletor acima — o cliente copia exatamente estes
// para a URL da rota de exportação, e a rota resolve o período com o MESMO
// config (mesma leitura, mesmo rótulo).
export const EXPORT_PERIOD_PARAM_KEYS = ["xperiodo", "xde", "xate", "xmes"] as const;

// O que incluir no PDF. Pelo menos um precisa estar marcado (o modal garante).
export const PDF_INCLUDE_ACTIVITIES = "atividades";
export const PDF_INCLUDE_NOTES = "anotacoes";

// Teto duro de itens (atividades + anotações) no período. Acima disso a rota
// recusa com 400 e pede para reduzir o período — proteção contra PDFs gigantes.
export const PDF_MAX_ITEMS = 3000;
