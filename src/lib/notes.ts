import DOMPurify from "isomorphic-dompurify";
import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";

type Client = Awaited<ReturnType<typeof createClient>>;

// Todo link de anotação abre em NOVA aba (não tirar o usuário do sistema),
// com rel de segurança. O DOMPurify remove `target` por padrão, então o hook
// (re)aplica depois da sanitização — vale também para anotações antigas.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Metadados de um documento anexo (guardados no JSONB company_notes.attachments;
// o arquivo em si vive no bucket note-files).
export type NoteAttachmentMeta = {
  path: string;
  name: string;
  size: number;
  mime: string;
};

export type NoteAttachmentView = NoteAttachmentMeta & { url: string };

// Uma anotação da empresa pronta para exibir (passo 24): conteúdo HTML do
// editor + autoria e auditoria de edição já resolvidas em nomes + anexos com
// URL pública pronta.
export type CompanyNoteView = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  contentHtml: string;
  visibleToClient: boolean;
  attachments: NoteAttachmentView[];
  createdAtISO: string;
  updatedAtISO: string | null;
  updatedByName: string | null;
  updatedByAvatarUrl: string | null;
};

function parseAttachments(raw: unknown, publicUrl: (path: string) => string): NoteAttachmentView[] {
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

// Anotações de UMA empresa, mais recentes primeiro. A RLS (cn_select) já escopa
// admin (todas), consultor (empresas dele) e colaborador (empresas onde tem
// tarefa). Nomes de autor/editor vêm da display_names (a RLS de profiles não
// deixa o colaborador ler perfis alheios).
export async function loadCompanyNotes(
  supabase: Client,
  companyId: string
): Promise<CompanyNoteView[]> {
  const { data } = await supabase
    .from("company_notes")
    .select(
      "id, author_id, content_html, visible_to_client, attachments, created_at, updated_at, updated_by"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    author_id: string;
    content_html: string;
    visible_to_client: boolean;
    attachments: unknown;
    created_at: string;
    updated_at: string | null;
    updated_by: string | null;
  };
  const rows = (data as Row[] | null) ?? [];

  const people = await resolvePeople(
    supabase,
    rows.flatMap((r) => [r.author_id, r.updated_by])
  );

  const publicUrl = (path: string) =>
    supabase.storage.from("note-files").getPublicUrl(path).data.publicUrl;

  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorName: people.get(r.author_id)?.name ?? "(usuário removido)",
    authorAvatarUrl: people.get(r.author_id)?.avatarUrl ?? null,
    attachments: parseAttachments(r.attachments, publicUrl),
    // Sanitiza no ponto único de leitura: o HTML vem do editor, mas quem grava
    // é o cliente (RLS) — nunca renderizar sem passar pelo DOMPurify (o mesmo
    // conteúdo será exposto ao cliente externo no passo 25).
    contentHtml: DOMPurify.sanitize(r.content_html),
    visibleToClient: r.visible_to_client,
    createdAtISO: r.created_at,
    updatedAtISO: r.updated_at,
    updatedByName: r.updated_by
      ? people.get(r.updated_by)?.name ?? null
      : null,
    updatedByAvatarUrl: r.updated_by
      ? people.get(r.updated_by)?.avatarUrl ?? null
      : null,
  }));
}
