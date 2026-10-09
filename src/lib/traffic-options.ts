// Opções das colunas do quadro Tráfego (Foco, Plataforma, Status). Fonte única
// dos rótulos e cores — espelha os enums traffic_focus/traffic_platform/
// traffic_status do banco (migration 0109). Mesma convenção do cs-status.ts.
//
// REGRA DA COR: o texto do rótulo está SEMPRE presente; a cor é reforço. As do
// Foco são propositalmente acinzentadas/muted (distintas entre si) para não
// competir com as cores vivas de Plataforma e Status em outras colunas.

export type TrafficFocus = "vendas" | "whatsapp" | "whatsapp_vendas" | "negocio_local";
export type TrafficPlatform = "nao_iniciado" | "meta" | "google" | "google_meta" | "bagy";
export type TrafficStatus =
  | "pausado"
  | "aguardando_conteudo"
  | "primeira_campanha"
  | "campanha_validada"
  | "projeto_entregue";

export type TrafficOption<V extends string = string> = {
  value: V;
  label: string;
  // Classe do chip (fundo tingido + texto + borda) — SEMPRE com texto legível no
  // claro e no escuro.
  chipClass: string;
};

// Foco — tons acinzentados distintos (azul / verde / ciano / marrom).
export const TRAFFIC_FOCUS: TrafficOption<TrafficFocus>[] = [
  {
    value: "vendas",
    label: "Vendas",
    chipClass: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    chipClass: "border-emerald-700/40 bg-emerald-800/10 text-emerald-800 dark:text-emerald-300",
  },
  {
    value: "whatsapp_vendas",
    label: "WhatsApp + Vendas",
    chipClass: "border-cyan-700/40 bg-cyan-800/10 text-cyan-800 dark:text-cyan-300",
  },
  {
    value: "negocio_local",
    label: "Negócio Local",
    chipClass: "border-stone-500/50 bg-stone-500/10 text-stone-700 dark:text-stone-300",
  },
];

// Plataforma — cores vivas.
export const TRAFFIC_PLATFORM: TrafficOption<TrafficPlatform>[] = [
  {
    value: "nao_iniciado",
    label: "Não Iniciado",
    chipClass: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
  {
    value: "meta",
    label: "Meta",
    chipClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    value: "google",
    label: "Google",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    value: "google_meta",
    label: "Google + Meta",
    chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    value: "bagy",
    label: "Bagy",
    chipClass: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  },
];

// Status — cores vivas.
export const TRAFFIC_STATUS: TrafficOption<TrafficStatus>[] = [
  {
    value: "pausado",
    label: "Pausado",
    chipClass: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
  {
    value: "aguardando_conteudo",
    label: "Aguardando Conteúdo",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    value: "primeira_campanha",
    label: "Primeira Campanha",
    chipClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    value: "campanha_validada",
    label: "Campanha Validada",
    chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    value: "projeto_entregue",
    label: "Projeto Entregue",
    chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
];

// Página do histórico do Tráfego (traffic_audit), mesmo tamanho do CS.
export const TRAFFIC_AUDIT_PAGE = 50;

// Opções por `field` do histórico (foco/plataforma/status), para o painel
// traduzir o valor cru do enum em rótulo.
export const TRAFFIC_OPTIONS_BY_FIELD: Record<string, TrafficOption[]> = {
  foco: TRAFFIC_FOCUS,
  plataforma: TRAFFIC_PLATFORM,
  status: TRAFFIC_STATUS,
};

// Rótulo de um valor de enum dentro de uma lista de opções. Desconhecido/nulo →
// o próprio valor (defensivo) ou string vazia.
export function optionLabel(options: TrafficOption[], value: string | null): string {
  if (value == null) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}
