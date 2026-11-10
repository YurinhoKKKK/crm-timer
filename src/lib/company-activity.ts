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

// Um par de→para dentro de details (banco grava {de, para} em pt-BR).
export type ActivityChange = { de?: unknown; para?: unknown };

// `meta` é o `details` jsonb do evento — varia por tipo. Tipamos os campos
// conhecidos e deixamos o resto aberto (índice) para o renderizador de de→para.
export type ActivityMeta = {
  seconds?: number;
  sentWhatsapp?: boolean;
  taskId?: string | null;
  taskTotalSeconds?: number | null;
  changes?: Record<string, ActivityChange | boolean>;
  de?: unknown;
  para?: unknown;
  [key: string]: unknown;
};

export type ActivityItem = {
  id: string;
  type: string;
  typeLabel: string; // rótulo pronto do banco (activity_type_label)
  category: string; // chave da categoria (banco)
  categoryLabel: string; // rótulo pronto da categoria (banco)
  at: string; // ISO (UTC do banco); a exibição converte para BRT
  authorId: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  summary: string; // primeira linha / resumo curto (do banco)
  content: string; // conteúdo completo
  meta: ActivityMeta;
};

export type ActivityAuthor = { id: string; name: string; avatar: string | null };

// Opção do filtro por TIPO/CATEGORIA — {value,label} vindos do banco (presentes
// na empresa). O rótulo SEMPRE vem do catálogo do banco; nunca exibimos o valor cru.
export type ActivityType = { value: string; label: string };
export type ActivityCategory = { value: string; label: string };

// Linha do tempo de responsáveis (RPC company_responsible_timeline).
export type ResponsiblePeriod = {
  id: string;
  personId: string;
  role: "consultor" | "colaborador";
  name: string;
  avatar: string | null;
  startDate: string | null; // "AAAA-MM-DD"; null = início não registrado (consultor reconstruído sem evento de adição)
  endDate: string | null; // null = período atual
  source: "registrado" | "reconstruido";
  startApprox: boolean; // período reconstruído mais antigo do colaborador: início é dos DADOS, não a entrada real ("desde pelo menos")
};

// Retorno da RPC company_responsible_timeline: períodos + data global de
// referência (1º registro de troca de responsável do sistema), usada no texto
// "antes de DD/MM/AAAA (início não registrado)" dos consultores sem início.
export type ResponsibleTimeline = {
  refDate: string | null; // "AAAA-MM-DD"
  periods: ResponsiblePeriod[];
};

// Filtros da tela. Tudo opcional; vazio = sem recorte (o histórico inteiro).
export type ActivityFilters = {
  search: string;
  category: string; // "" = todas as categorias
  type: string; // "" = todos os tipos
  authorId: string; // "" = todas as pessoas
  from: string; // "AAAA-MM-DD" | ""
  to: string; // "AAAA-MM-DD" | ""
};

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = {
  search: "",
  category: "",
  type: "",
  authorId: "",
  from: "",
  to: "",
};

export function hasActiveFilters(f: ActivityFilters): boolean {
  return !!(f.search || f.category || f.type || f.authorId || f.from || f.to);
}

// Autor exibível: actor nulo = sistema/cron/cliente -> "Sistema".
export function activityAuthorName(item: ActivityItem): string {
  return item.authorName ?? "Sistema";
}

// Rótulos pt-BR dos CAMPOS que aparecem em details.changes / details.<campo>.
const FIELD_LABELS: Record<string, string> = {
  titulo: "Título",
  prazo: "Prazo",
  horaLimite: "Hora-limite",
  descricao: "Descrição",
  instrucoes: "Instruções",
  categoria: "Categoria",
  tipo: "Tipo",
  dias: "Dias",
  responsavel: "Responsável",
  reativada: "Reativada",
  modelo: "Modelo",
  inicio: "Início",
  fim: "Fim",
  cadencia: "Cadência",
  sistema: "Sistema",
  projeto: "Valor do projeto",
  parcelas: "Parcelas",
  data: "Data",
  vendedor: "Vendedor",
  mrr: "MRR",
  motivoAlterado: "Motivo",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vazio)";
  if (Array.isArray(v)) return v.map((x) => fmtValue(x)).join(", ") || "(vazio)";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (ISO_DATETIME.test(v)) return formatActivityAt(v);
    if (ISO_DATE.test(v)) {
      const [y, m, d] = v.split("-");
      return `${d}/${m}/${y}`;
    }
    return v;
  }
  if (typeof v === "object") {
    const o = v as ActivityChange;
    if ("de" in o || "para" in o) return `${fmtValue(o.de)} → ${fmtValue(o.para)}`;
    return JSON.stringify(v);
  }
  return String(v);
}

// Reserved: campos de meta que NÃO são "mudança de→para" exibível.
const META_RESERVED = new Set([
  "seconds",
  "sentWhatsapp",
  "taskId",
  "taskTotalSeconds",
  "changes",
  "de",
  "para",
]);

export type ChangeLine = { label: string; from?: string; to?: string; note?: string };

// Extrai as linhas de→para de um evento para o detalhe expansível. Nunca inventa
// conteúdo: só lê o que o banco gravou em details. (O texto de anotação e o valor
// do motivo de churn NÃO vêm em details, então nunca aparecem aqui.)
export function activityChangeLines(meta: ActivityMeta | null | undefined): ChangeLine[] {
  if (!meta) return [];
  const lines: ChangeLine[] = [];

  // 1) details.changes = { campo: {de,para} | true }
  if (meta.changes && typeof meta.changes === "object") {
    for (const [key, val] of Object.entries(meta.changes)) {
      if (val === true) {
        lines.push({ label: fieldLabel(key), note: "alterado" });
      } else if (val && typeof val === "object") {
        const c = val as ActivityChange;
        lines.push({ label: fieldLabel(key), from: fmtValue(c.de), to: fmtValue(c.para) });
      }
    }
  }

  // 2) campos de topo que são objetos {de,para} (ex.: projeto, parcelas).
  for (const [key, val] of Object.entries(meta)) {
    if (META_RESERVED.has(key)) continue;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const o = val as ActivityChange;
      if ("de" in o || "para" in o) {
        lines.push({ label: fieldLabel(key), from: fmtValue(o.de), to: fmtValue(o.para) });
      }
    }
  }

  // 3) de/para no topo (ex.: empresa_renomeada, cs_alterado, pausa_*, *_trocado).
  if (meta.de !== undefined || meta.para !== undefined) {
    lines.push({ label: "", from: fmtValue(meta.de), to: fmtValue(meta.para) });
  }

  return lines;
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
