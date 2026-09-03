// Histórico de atividades da empresa (Fatia 1 — apresentação). Tipos e helpers
// compartilhados entre a server action (leitura via RPC) e o componente cliente.
// A linha do tempo é UNIFICADA: hoje só o tipo "atividade", mas o shape já
// comporta os tipos da Fatia 2 sem reescrever a tela.

export const ACTIVITY_PAGE_SIZE = 20;

// Catálogo de TIPOS de evento. Fatia 2 acrescenta linhas aqui e o filtro/rótulo
// passam a conhecê-las sem tocar no componente. Rótulo desconhecido cai no id.
export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  atividade: "Atividade",
};

export function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_LABEL[type] ?? type;
}

// Opções do filtro por tipo (na ordem do catálogo). Monta-se a partir do mapa,
// então tipos novos aparecem automaticamente.
export const ACTIVITY_TYPE_OPTIONS = Object.entries(ACTIVITY_TYPE_LABEL).map(
  ([value, label]) => ({ value, label })
);

export type ActivityMeta = {
  seconds?: number;
  sentWhatsapp?: boolean;
  taskId?: string | null;
};

export type ActivityItem = {
  id: string;
  type: string;
  at: string; // ISO (UTC do banco); a exibição converte para BRT
  authorId: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  summary: string; // primeira linha / resumo curto (do banco)
  content: string; // conteúdo completo
  meta: ActivityMeta;
};

export type ActivityAuthor = { id: string; name: string; avatar: string | null };

// Filtros da tela. Tudo opcional; vazio = sem recorte (o histórico inteiro).
export type ActivityFilters = {
  search: string;
  type: string; // "" = todos os tipos
  authorId: string; // "" = todas as pessoas
  from: string; // "AAAA-MM-DD" | ""
  to: string; // "AAAA-MM-DD" | ""
};

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = {
  search: "",
  type: "",
  authorId: "",
  from: "",
  to: "",
};

export function hasActiveFilters(f: ActivityFilters): boolean {
  return !!(f.search || f.type || f.authorId || f.from || f.to);
}

// Data/hora do evento em Brasília (o banco guarda UTC). Sem fixar o timeZone, a
// mesma tela mostraria horários diferentes conforme o fuso do navegador.
const BRT_FMT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatActivityAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return BRT_FMT.format(d).replace(",", " ·");
}

// Um evento é expansível quando o conteúdo completo diz mais que o resumo.
export function isExpandable(item: ActivityItem): boolean {
  return item.content.trim() !== item.summary.trim();
}
