// Controle de Churn (quadro CS, etapa 1) — opções de MOTIVO no cliente.
//
// Os motivos escolhíveis ao mover uma empresa para um grupo 'cancelado' são os 6
// primeiros do enum churn_reason (migration 0120). 'nao_informado' existe SÓ para
// o preenchimento dos registros antigos e NUNCA é oferecido aqui (o gatilho BEFORE
// do banco também o recusa). Os rótulos espelham churn_reason_label() do banco.

export type ChurnReason =
  | "erro_consultoria"
  | "erro_comercial"
  | "erro_gestao_cliente"
  | "cliente_demitido"
  | "projeto_finalizado"
  | "decisao_cliente";

// Rótulo + COR de cada motivo (fonte única). A cor é só reforço — o rótulo está
// sempre presente — na MESMA convenção de cs-status.ts / traffic-options.ts
// (border + fundo tingido + texto legível no claro e no escuro). Semântica das
// cores: os três ERROS em tons quentes (vermelho/laranja/âmbar = "falha nossa");
// causas externas/neutras em frios (cliente demitido = violeta; decisão do
// cliente = azul); projeto finalizado em ardósia (desfecho neutro); não informado
// sem cor (placeholder). Inclui 'projeto_finalizado' e 'nao_informado' para
// EXIBIR qualquer motivo vindo do banco. Espelha churn_reason_label() (0120).
export const CHURN_REASON_META: Record<string, { label: string; chipClass: string }> = {
  erro_consultoria: {
    label: "Erro consultoria",
    chipClass: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  erro_comercial: {
    label: "Erro comercial",
    chipClass: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  erro_gestao_cliente: {
    label: "Erro gestão cliente",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  cliente_demitido: {
    label: "Cliente demitido",
    chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  projeto_finalizado: {
    label: "Projeto finalizado",
    chipClass: "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  decisao_cliente: {
    label: "Decisão do cliente",
    chipClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  nao_informado: {
    label: "Não informado",
    chipClass: "border-line text-fg-subtle",
  },
};

// Os 6 motivos escolhíveis ao cancelar (ordem), já com rótulo e cor — servem o
// diálogo de motivo (etapa 1) E o seletor da coluna Motivo (ChipPicker).
const CHOOSABLE_REASONS: ChurnReason[] = [
  "erro_consultoria",
  "erro_comercial",
  "erro_gestao_cliente",
  "cliente_demitido",
  "projeto_finalizado",
  "decisao_cliente",
];

export const CHURN_REASON_OPTIONS: {
  value: ChurnReason;
  label: string;
  chipClass: string;
}[] = CHOOSABLE_REASONS.map((v) => ({
  value: v,
  label: CHURN_REASON_META[v].label,
  chipClass: CHURN_REASON_META[v].chipClass,
}));

// Ordem de exibição do resumo "Quantidade por motivo" (nao_informado por último).
export const CHURN_REASON_SUMMARY_ORDER = [
  "erro_consultoria",
  "erro_comercial",
  "erro_gestao_cliente",
  "cliente_demitido",
  "projeto_finalizado",
  "decisao_cliente",
  "nao_informado",
] as const;

// Rótulo de qualquer motivo (vindo do banco). Desconhecido cai no próprio valor.
export function churnReasonLabel(value: string | null): string {
  if (!value) return "—";
  return CHURN_REASON_META[value]?.label ?? value;
}

// Classe de cor do chip de um motivo. Desconhecido/nulo → sem cor (placeholder).
export function churnReasonChipClass(value: string | null): string {
  return (value && CHURN_REASON_META[value]?.chipClass) || "border-line text-fg-subtle";
}

// Campos do histórico (cs_audit) específicos do Controle de Churn — o painel da
// aba filtra por estes (inclui 'churn' da captura da etapa 1 + as edições da 2).
export const CHURN_AUDIT_FIELDS = [
  "churn",
  "churn_data",
  "churn_motivo",
  "churn_vendedor",
  "churn_mrr",
] as const;
