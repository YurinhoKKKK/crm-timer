// Histórico de atividades da empresa (Fatia 1 — apresentação; Fatia 2 — fontes).
// Tipos e helpers compartilhados entre a server action (leitura via RPC) e o
// componente cliente. A linha do tempo é UNIFICADA e agora reúne várias fontes
// (activity_log + company_events + client_portal_audit) no banco.

export const ACTIVITY_PAGE_SIZE = 20;

// O CATÁLOGO de tipos deixou de morar aqui: o filtro e os rótulos vêm do banco
// (RPC company_activity_types + campo `typeLabel` por item). Isto evita uma lista
// fixa que envelhece a cada tipo novo. Só resta um fallback defensivo para o caso
// (não esperado) de um item chegar sem rótulo.
export function activityTypeLabel(type: string, label?: string | null): string {
  return label && label.trim() ? label : type;
}

export type ActivityMeta = {
  seconds?: number;
  sentWhatsapp?: boolean;
  taskId?: string | null;
};

export type ActivityItem = {
  id: string;
  type: string;
  typeLabel: string; // rótulo pronto do banco (activity_type_label)
  at: string; // ISO (UTC do banco); a exibição converte para BRT
  authorId: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  summary: string; // primeira linha / resumo curto (do banco)
  content: string; // conteúdo completo
  meta: ActivityMeta;
};

export type ActivityAuthor = { id: string; name: string; avatar: string | null };

// Opção do filtro por TIPO — {value,label} vindos do banco (tipos realmente
// presentes na empresa).
export type ActivityType = { value: string; label: string };

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
