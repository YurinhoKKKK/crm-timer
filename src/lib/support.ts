import type { createClient } from "@/lib/supabase-server";
import type { Database } from "@/lib/types";
import type { NoteAttachmentView } from "@/lib/notes";
import { getNoteSanitizer } from "@/lib/notes";
import { resolvePeople } from "@/lib/creator";

// =====================================================================
// Chamados internos de suporte (Fatia 1). 100% interno — nada aqui toca o portal
// do cliente. O grupo Abertos/Finalizados é DERIVADO do status (nunca um campo).
// =====================================================================

type Client = Awaited<ReturnType<typeof createClient>>;

export type TicketUrgency = Database["public"]["Enums"]["ticket_urgency"];
export type TicketIssueType = Database["public"]["Enums"]["ticket_issue_type"];
export type TicketStatus = Database["public"]["Enums"]["ticket_status"];

// Teto de carga (desempenho): a lista é paginada no cliente sobre o que foi
// carregado; as CONTAGENS dos grupos vêm de um count no banco (RPC), nunca do
// tamanho deste array — que pode ser truncado.
const LOAD_CAP = 300;

// --- Metadados visuais (fonte única) --------------------------------- //
// O texto do rótulo acompanha SEMPRE a cor (a cor nunca é o único sinal — mesmo
// princípio do semáforo do acompanhamento). Classes literais para o Tailwind
// não perder o purge.

type ChipUI = { label: string; chip: string; dot: string };

export const URGENCY_UI: Record<TicketUrgency, ChipUI> = {
  baixa: {
    label: "Baixa",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
  media: {
    label: "Média",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    dot: "bg-amber-500",
  },
  alta: {
    label: "Alta",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    dot: "bg-red-500",
  },
};

export const ISSUE_TYPE_UI: Record<TicketIssueType, ChipUI> = {
  integracao: {
    label: "Integração",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    dot: "bg-indigo-500",
  },
  chamado: {
    label: "Chamado",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
    dot: "bg-slate-500",
  },
  bo_tray: {
    label: "B.O Tray",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    dot: "bg-sky-500",
  },
  bo_ml: {
    label: "B.O ML",
    chip: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30",
    dot: "bg-yellow-500",
  },
  bo_amazon: {
    label: "B.O Amazon",
    chip: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
    dot: "bg-orange-500",
  },
  bo_shopee: {
    label: "B.O Shopee",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    dot: "bg-rose-500",
  },
  bo_notas: {
    label: "B.O Notas",
    chip: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
    dot: "bg-teal-500",
  },
};

export const STATUS_UI: Record<TicketStatus, ChipUI> = {
  em_andamento: {
    label: "Em andamento",
    chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    dot: "bg-blue-500",
  },
  parado: {
    label: "Parado",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
    dot: "bg-slate-500",
  },
  aguardando_cliente: {
    label: "Aguardando cliente",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    dot: "bg-amber-500",
  },
  aguardando_email: {
    label: "Aguardando e-mail",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
    dot: "bg-violet-500",
  },
  finalizado: {
    label: "Finalizado",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
};

// Ordem de exibição dos selects/menus (não alfabética — do mais leve ao mais
// urgente; do estado inicial ao final).
export const URGENCY_ORDER: TicketUrgency[] = ["baixa", "media", "alta"];
export const ISSUE_TYPE_ORDER: TicketIssueType[] = [
  "integracao",
  "chamado",
  "bo_tray",
  "bo_ml",
  "bo_amazon",
  "bo_shopee",
  "bo_notas",
];
export const STATUS_ORDER: TicketStatus[] = [
  "em_andamento",
  "parado",
  "aguardando_cliente",
  "aguardando_email",
  "finalizado",
];

// Grupo derivado do status — nunca um campo próprio (duas fontes de verdade
// divergiriam). finalizado = Finalizados; qualquer outro = Abertos.
export function isOpenStatus(status: TicketStatus): boolean {
  return status !== "finalizado";
}

// --- Carregamento ---------------------------------------------------- //

export type SupportTicketView = {
  id: string;
  title: string;
  contextHtml: string; // já sanitizado (ponto único de leitura)
  attachments: NoteAttachmentView[];
  urgency: TicketUrgency;
  issueType: TicketIssueType;
  status: TicketStatus;
  createdById: string;
  authorName: string;
  authorFirstName: string;
  authorAvatarUrl: string | null;
  createdAtISO: string;
  updatedAtISO: string | null;
  updatedByName: string | null;
  finishedAtISO: string | null;
  // Nº de respostas (Fatia 2), agregado no banco (nunca do array carregado).
  replyCount: number;
};

// Uma resposta de chamado pronta para exibir (Fatia 2): corpo HTML já
// sanitizado + autoria resolvida em nome/foto + anexos com URL pronta.
export type TicketReplyView = {
  id: string;
  ticketId: string;
  bodyHtml: string; // já sanitizado (ponto único de leitura)
  attachments: NoteAttachmentView[];
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  createdAtISO: string;
  editedAtISO: string | null;
};

export type SupportTicketsData = {
  tickets: SupportTicketView[];
  counts: { open: number; finished: number };
  truncated: boolean;
};

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

function parseAttachments(
  raw: unknown,
  publicUrl: (path: string) => string
): NoteAttachmentView[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteAttachmentView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.path !== "string" || typeof a.name !== "string") continue;
    out.push({
      path: a.path,
      name: a.name,
      size: typeof a.size === "number" ? a.size : 0,
      mime: typeof a.mime === "string" ? a.mime : "",
      url: publicUrl(a.path),
    });
  }
  return out;
}

// Todos os chamados (a RLS st_select libera qualquer cargo interno; pending/anon
// não recebem nada). O context_html é sanitizado no MESMO ponto único de leitura
// das anotações (getNoteSanitizer), com o carregador preguiçoso memoizado — nunca
// importe isomorphic-dompurify no topo de um módulo de rota (custo de jsdom no
// cold start, passo 29). As CONTAGENS vêm da RPC (count no banco), não do array.
export async function loadSupportTickets(
  supabase: Client
): Promise<SupportTicketsData> {
  const [{ data, error }, countRes, replyCountRes] = await Promise.all([
    supabase
      .from("support_tickets")
      .select(
        "id, title, context_html, attachments, urgency, issue_type, status, created_by, created_at, updated_at, updated_by, finished_at"
      )
      .order("created_at", { ascending: false })
      .limit(LOAD_CAP),
    supabase.rpc("support_ticket_counts"),
    supabase.rpc("support_ticket_reply_counts"),
  ]);

  if (error) throw error;

  // Respostas por chamado, agregadas no banco (RPC) — só volta ticket com >0.
  const replyCounts = new Map<string, number>();
  for (const r of (replyCountRes.data as
    | { ticket_id: string; reply_count: number }[]
    | null) ?? []) {
    replyCounts.set(r.ticket_id, Number(r.reply_count));
  }

  type Row = {
    id: string;
    title: string;
    context_html: string;
    attachments: unknown;
    urgency: TicketUrgency;
    issue_type: TicketIssueType;
    status: TicketStatus;
    created_by: string;
    created_at: string;
    updated_at: string | null;
    updated_by: string | null;
    finished_at: string | null;
  };
  const rows = (data as Row[] | null) ?? [];

  const countRow = (countRes.data as
    | { open_count: number; finished_count: number }[]
    | null)?.[0];
  const counts = {
    open: Number(countRow?.open_count ?? 0),
    finished: Number(countRow?.finished_count ?? 0),
  };

  if (rows.length === 0) {
    return { tickets: [], counts, truncated: false };
  }

  const [people, sanitize] = await Promise.all([
    resolvePeople(
      supabase,
      rows.flatMap((r) => [r.created_by, r.updated_by])
    ),
    getNoteSanitizer(),
  ]);

  const publicUrl = (path: string) =>
    supabase.storage.from("note-files").getPublicUrl(path).data.publicUrl;

  const tickets: SupportTicketView[] = rows.map((r) => {
    const author = people.get(r.created_by);
    const name = author?.name ?? "(usuário removido)";
    return {
      id: r.id,
      title: r.title,
      // Sanitiza no ponto único de leitura — o HTML vem do editor, nunca
      // renderizar sem passar por aqui.
      contextHtml: sanitize(r.context_html),
      attachments: parseAttachments(r.attachments, publicUrl),
      urgency: r.urgency,
      issueType: r.issue_type,
      status: r.status,
      createdById: r.created_by,
      authorName: name,
      authorFirstName: firstName(name),
      authorAvatarUrl: author?.avatarUrl ?? null,
      createdAtISO: r.created_at,
      updatedAtISO: r.updated_at,
      updatedByName: r.updated_by
        ? people.get(r.updated_by)?.name ?? null
        : null,
      finishedAtISO: r.finished_at,
      replyCount: replyCounts.get(r.id) ?? 0,
    };
  });

  return { tickets, counts, truncated: rows.length >= LOAD_CAP };
}

// Respostas de UM chamado, mais recentes primeiro (a RLS str_select já escopa a
// cargo interno). O body_html é sanitizado no MESMO ponto único de leitura das
// anotações/contexto (getNoteSanitizer, carregador preguiçoso memoizado) — nunca
// renderizar sem passar por aqui, nunca importar dompurify no topo de rota.
export async function loadTicketReplies(
  supabase: Client,
  ticketId: string
): Promise<TicketReplyView[]> {
  const { data, error } = await supabase
    .from("support_ticket_replies")
    .select("id, ticket_id, body_html, attachments, author_id, created_at, edited_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  type Row = {
    id: string;
    ticket_id: string;
    body_html: string;
    attachments: unknown;
    author_id: string;
    created_at: string;
    edited_at: string | null;
  };
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) return [];

  const [people, sanitize] = await Promise.all([
    resolvePeople(
      supabase,
      rows.map((r) => r.author_id)
    ),
    getNoteSanitizer(),
  ]);

  const publicUrl = (path: string) =>
    supabase.storage.from("note-files").getPublicUrl(path).data.publicUrl;

  return rows.map((r) => {
    const author = people.get(r.author_id);
    return {
      id: r.id,
      ticketId: r.ticket_id,
      bodyHtml: sanitize(r.body_html),
      attachments: parseAttachments(r.attachments, publicUrl),
      authorId: r.author_id,
      authorName: author?.name ?? "(usuário removido)",
      authorAvatarUrl: author?.avatarUrl ?? null,
      createdAtISO: r.created_at,
      editedAtISO: r.edited_at,
    };
  });
}
