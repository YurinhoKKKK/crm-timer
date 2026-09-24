import type { TaskCategory } from "@/lib/types";

// Categorias do cadastro de tarefas (padronização). ORDEM FIXA — usada tanto no
// seletor do formulário quanto na legenda/segmentos do gráfico por categoria,
// para que cor e posição sejam estáveis em toda a interface.
//
// `criar_conta` é "Criar conta (Plataforma)" na interface (rótulo pedido pelo
// Mauricio); no banco é o enum curto `criar_conta`.
export const TASK_CATEGORIES: { value: TaskCategory; label: string }[] = [
  { value: "cadastro", label: "Cadastro" },
  { value: "precificacao", label: "Precificação" },
  { value: "anuncio", label: "Anúncio" },
  { value: "estudo", label: "Estudo" },
  { value: "listagem", label: "Listagem" },
  { value: "integracao", label: "Integração" },
  { value: "criar_conta", label: "Criar conta (Plataforma)" },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  TASK_CATEGORIES.map((c) => [c.value, c.label])
);

// Rótulo tolerante: aceita qualquer string (ex.: o bucket 'listagem' que vem da
// RPC para listagens antigas sem category) e cai no próprio valor se desconhecido.
export function categoryLabel(value: string): string {
  return CATEGORY_LABEL[value] ?? value;
}

export const CATEGORY_ORDER: Record<string, number> = Object.fromEntries(
  TASK_CATEGORIES.map((c, i) => [c.value, i])
);

// Paleta categórica — uma cor por categoria, com variante para tema claro/escuro
// (o gráfico recolore conforme o tema, como os outros do sistema). Cores
// escolhidas para contraste entre si e legibilidade nos dois fundos.
const CATEGORY_COLORS: Record<TaskCategory, { light: string; dark: string }> = {
  cadastro: { light: "#3145FF", dark: "#8090FF" },
  precificacao: { light: "#0E9F6E", dark: "#34D399" },
  anuncio: { light: "#EA580C", dark: "#FB923C" },
  estudo: { light: "#9333EA", dark: "#C084FC" },
  listagem: { light: "#0891B2", dark: "#22D3EE" },
  integracao: { light: "#B45309", dark: "#FBBF24" },
  criar_conta: { light: "#DB2777", dark: "#F472B6" },
};

const FALLBACK_COLOR = { light: "#6B7280", dark: "#9AA2AC" };

export function categoryColor(value: string, dark: boolean): string {
  const c = CATEGORY_COLORS[value as TaskCategory] ?? FALLBACK_COLOR;
  return dark ? c.dark : c.light;
}
