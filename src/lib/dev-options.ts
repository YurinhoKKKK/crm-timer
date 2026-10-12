// Opções da coluna Status do quadro "Desenvolvimento". Fonte única dos rótulos e
// cores — espelha o enum dev_status do banco (migration 0115). Mesma convenção do
// traffic-options.ts / cs-status.ts.
//
// REGRA DA COR: o texto do rótulo está SEMPRE presente; a cor é reforço. As cores
// seguem a descrição acordada para cada status (e combinam com as cores dos grupos
// correspondentes). NÃO existe "Urgente".

export type DevStatus =
  | "lista_espera"
  | "aguardando_formulario"
  | "formulario_incompleto"
  | "em_desenvolvimento"
  | "entregue"
  | "pendencia_cliente"
  | "pausado"
  | "cancelado"
  | "gestao_site";

export type DevOption<V extends string = string> = {
  value: V;
  label: string;
  // Classe do chip (fundo tingido + texto + borda) — legível no claro e no escuro.
  chipClass: string;
};

// Status — cada rótulo com a cor acordada:
//   Lista de Espera cinza; Aguardando Formulário âmbar; Formulário Incompleto
//   laranja; Em Desenvolvimento azul; Entregue verde; Pendência Cliente rosa;
//   Pausado âmbar escuro; Cancelado vermelho; Gestão de site verde-azulado.
export const DEV_STATUS: DevOption<DevStatus>[] = [
  {
    value: "lista_espera",
    label: "Lista de Espera",
    chipClass: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
  {
    value: "aguardando_formulario",
    label: "Aguardando Formulário",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    value: "formulario_incompleto",
    label: "Formulário Incompleto",
    chipClass: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  {
    value: "em_desenvolvimento",
    label: "Em Desenvolvimento",
    chipClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    value: "entregue",
    label: "Entregue",
    chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "pendencia_cliente",
    label: "Pendência Cliente",
    chipClass: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  },
  {
    value: "pausado",
    label: "Pausado",
    chipClass: "border-amber-700/50 bg-amber-700/15 text-amber-800 dark:text-amber-300",
  },
  {
    value: "cancelado",
    label: "Cancelado",
    chipClass: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  {
    value: "gestao_site",
    label: "Gestão de site",
    chipClass: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
];

// Página do histórico do Desenvolvimento (dev_audit), mesmo tamanho dos demais.
export const DEV_AUDIT_PAGE = 50;

// Opções por `field` do histórico (status), para o painel traduzir o valor cru do
// enum em rótulo. O campo 'grupo' guarda o NOME do grupo (não precisa de tradução).
export const DEV_OPTIONS_BY_FIELD: Record<string, DevOption[]> = {
  status: DEV_STATUS,
};

// Rótulo de um valor de enum dentro de uma lista de opções. Desconhecido/nulo →
// o próprio valor (defensivo) ou string vazia.
export function optionLabel(options: DevOption[], value: string | null): string {
  if (value == null) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}
