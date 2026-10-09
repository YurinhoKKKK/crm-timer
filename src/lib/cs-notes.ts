import type { createClient } from "@/lib/supabase-server";
import type {
  CompanyNoteView,
  NoteAttachmentView,
  NoteReplyView,
} from "@/lib/notes";
import { getNoteSanitizer } from "@/lib/notes";
import { resolvePeople } from "@/lib/creator";

// Leitura das "Atualizações do CS" (tabelas cs_notes / cs_note_replies). Espelha
// lib/notes.ts (loadCompanyNotes / loadNoteReplies), com DUAS diferenças:
//  · Sem áreas e sem "visível ao cliente" (não existem no CS) — areas=[] e
//    visibleToClient=false, só para caber na mesma CompanyNoteView que o painel
//    compartilhado consome.
//  · Anexos num bucket PRIVADO admin-only (cs-note-files): a URL é ASSINADA na
//    leitura (createSignedUrl), não pública. Quem não é admin não lê a linha
//    (RLS) nem consegue assinar (policy do storage).
//
// A RLS admin-only das tabelas é a barreira; estas funções rodam com a sessão do
// usuário (SECURITY INVOKER de fato), então um não-admin recebe lista vazia.

type Client = Awaited<ReturnType<typeof createClient>>;

const CS_BUCKET = "cs-note-files";
const SIGNED_TTL = 3600; // 1h — a sessão do painel é curta; re-assina a cada leitura.

function parseAttachmentMeta(
  raw: unknown
): { path: string; name: string; size: number; mime: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { path: string; name: string; size: number; mime: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.path !== "string" || typeof a.name !== "string") continue;
    out.push({
      path: a.path,
      name: a.name,
      size: typeof a.size === "number" ? a.size : 0,
      mime: typeof a.mime === "string" ? a.mime : "",
    });
  }
  return out;
}

// Assina em LOTE todos os caminhos de anexo (uma ida ao Storage). Admin-only pela
// policy do bucket privado; se a assinatura falhar, o anexo fica sem URL.
async function signAll(
  supabase: Client,
  paths: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths));
  if (unique.length === 0) return map;
  const { data } = await supabase.storage
    .from(CS_BUCKET)
    .createSignedUrls(unique, SIGNED_TTL);
  for (const r of (data as { path: string | null; signedUrl: string }[] | null) ??
    []) {
    if (r.path && r.signedUrl) map.set(r.path, r.signedUrl);
  }
  return map;
}

function toViews(
  metas: { path: string; name: string; size: number; mime: string }[],
  urls: Map<string, string>
): NoteAttachmentView[] {
  return metas.map((m) => ({ ...m, url: urls.get(m.path) ?? "" }));
}

// Notas do CS de UMA empresa, mais recentes primeiro. Mesma forma de
// CompanyNoteView (o painel é compartilhado), com areas=[] e visibleToClient=false.
export async function loadCsNotes(
  supabase: Client,
  companyId: string
): Promise<CompanyNoteView[]> {
  const { data } = await supabase
    .from("cs_notes")
    .select(
      "id, author_id, content_html, attachments, created_at, updated_at, updated_by"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    author_id: string;
    content_html: string;
    attachments: unknown;
    created_at: string;
    updated_at: string | null;
    updated_by: string | null;
  };
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) return [];

  const metasById = new Map(
    rows.map((r) => [r.id, parseAttachmentMeta(r.attachments)])
  );
  const [people, sanitize, replyCountRes, signed] = await Promise.all([
    resolvePeople(
      supabase,
      rows.flatMap((r) => [r.author_id, r.updated_by])
    ),
    getNoteSanitizer(),
    supabase.rpc("cs_note_reply_counts", { p_company: companyId }),
    signAll(
      supabase,
      rows.flatMap((r) => (metasById.get(r.id) ?? []).map((m) => m.path))
    ),
  ]);

  const replyCounts = new Map<string, number>();
  for (const r of (replyCountRes.data as
    | { note_id: string; reply_count: number }[]
    | null) ?? []) {
    replyCounts.set(r.note_id, Number(r.reply_count));
  }

  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorName: people.get(r.author_id)?.name ?? "(usuário removido)",
    authorAvatarUrl: people.get(r.author_id)?.avatarUrl ?? null,
    areas: [],
    attachments: toViews(metasById.get(r.id) ?? [], signed),
    contentHtml: sanitize(r.content_html),
    visibleToClient: false,
    origin: null, // o CS não usa origem de Tráfego (tabelas próprias)
    createdAtISO: r.created_at,
    updatedAtISO: r.updated_at,
    updatedByName: r.updated_by ? people.get(r.updated_by)?.name ?? null : null,
    updatedByAvatarUrl: r.updated_by
      ? people.get(r.updated_by)?.avatarUrl ?? null
      : null,
    replyCount: replyCounts.get(r.id) ?? 0,
  }));
}

// Respostas de UMA nota do CS, mais antigas primeiro (mesma forma de NoteReplyView).
export async function loadCsNoteReplies(
  supabase: Client,
  noteId: string
): Promise<NoteReplyView[]> {
  const { data, error } = await supabase
    .from("cs_note_replies")
    .select("id, note_id, parent_id, body_html, attachments, author_id, created_at, edited_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  type Row = {
    id: string;
    note_id: string;
    parent_id: string | null;
    body_html: string;
    attachments: unknown;
    author_id: string;
    created_at: string;
    edited_at: string | null;
  };
  const rows = (data as Row[] | null) ?? [];
  if (rows.length === 0) return [];

  const metasById = new Map(
    rows.map((r) => [r.id, parseAttachmentMeta(r.attachments)])
  );
  const [people, sanitize, signed] = await Promise.all([
    resolvePeople(
      supabase,
      rows.map((r) => r.author_id)
    ),
    getNoteSanitizer(),
    signAll(
      supabase,
      rows.flatMap((r) => (metasById.get(r.id) ?? []).map((m) => m.path))
    ),
  ]);

  return rows.map((r) => {
    const author = people.get(r.author_id);
    return {
      id: r.id,
      noteId: r.note_id,
      parentId: r.parent_id,
      bodyHtml: sanitize(r.body_html),
      attachments: toViews(metasById.get(r.id) ?? [], signed),
      authorId: r.author_id,
      authorName: author?.name ?? "(usuário removido)",
      authorAvatarUrl: author?.avatarUrl ?? null,
      createdAtISO: r.created_at,
      editedAtISO: r.edited_at,
    };
  });
}
