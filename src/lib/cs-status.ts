// Status de NPS do quadro "Sucesso do Cliente". Fonte única dos rótulos e cores,
// compartilhada pelos seletores, chips, células e painel de histórico.
//
// A cor NUNCA é o único sinal: o texto do status está sempre presente.

export type CsNpsStatus =
  | "promotor"
  | "neutro"
  | "detrator"
  | "churn_erro_operacional"
  | "churn_projeto_finalizado";

export type CsStatusMeta = {
  value: CsNpsStatus;
  // Rótulo do seletor/popover (também usado como title — rótulo completo).
  selectLabel: string;
  // Texto curto no chip/célula.
  shortLabel: string;
  // Classe de cor do chip (tinte de fundo + texto + borda, sempre com texto).
  chipClass: string;
};

export const CS_STATUS_META: Record<CsNpsStatus, CsStatusMeta> = {
  promotor: {
    value: "promotor",
    selectLabel: "9 e 10 - Promotor",
    shortLabel: "Promotor",
    chipClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  neutro: {
    value: "neutro",
    selectLabel: "8 e 7 - Neutro",
    shortLabel: "Neutro",
    chipClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  detrator: {
    value: "detrator",
    selectLabel: "6 a 0 - Detrator",
    shortLabel: "Detrator",
    chipClass:
      "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  churn_erro_operacional: {
    value: "churn_erro_operacional",
    selectLabel: "Churn - erro operacional",
    shortLabel: "Churn: erro operacional",
    // Vermelho ESCURO (distinto do detrator).
    chipClass:
      "border-red-900/40 bg-red-900/10 text-red-900 dark:text-red-200",
  },
  churn_projeto_finalizado: {
    value: "churn_projeto_finalizado",
    selectLabel: "Churn - projeto finalizado",
    shortLabel: "Churn: projeto finalizado",
    // Cinza.
    chipClass:
      "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
};

// NPS Geral usa as 5 opções (na ordem).
export const CS_GENERAL_ORDER: CsNpsStatus[] = [
  "promotor",
  "neutro",
  "detrator",
  "churn_erro_operacional",
  "churn_projeto_finalizado",
];

// NPS individual usa só promotor/neutro/detrator (churn é desfecho da EMPRESA).
export const CS_PERSON_ORDER: CsNpsStatus[] = ["promotor", "neutro", "detrator"];

// Tamanho da página do histórico do CS (cs_audit). Fora do módulo "use server"
// (lá só podem sair funções async).
export const CS_AUDIT_PAGE = 50;

// Rótulo de qualquer valor (vindo do banco, inclusive do histórico). Desconhecido
// cai no próprio valor (defensivo; não deve acontecer).
export function csStatusShort(value: string | null): string {
  if (!value) return "Sem NPS";
  return (CS_STATUS_META as Record<string, CsStatusMeta>)[value]?.shortLabel ?? value;
}
