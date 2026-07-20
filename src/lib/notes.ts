import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";

type Client = Awaited<ReturnType<typeof createClient>>;

// --- Sanitização (DOMPurify) --------------------------------------------- //
//
// PERFORMANCE: `isomorphic-dompurify` arrasta o jsdom no servidor e custa ~1,5s
// só para CARREGAR o módulo. Enquanto o import era estático no topo deste
// arquivo, toda rota que importasse `lib/notes` (central da empresa do admin e
// do consultor, empresa do colaborador, portal do cliente) pagava esse 1,5s a
// cada COLD START na Vercel — mesmo quando a empresa não tinha anotação
// nenhuma. Local isso não aparecia porque o processo do `next start` fica vivo
// e paga uma vez só.
//
// Agora o módulo é carregado sob demanda, na PRIMEIRA anotação que precisar ser
// sanitizada, e fica em cache pelo resto da vida do processo. Rotas sem
// anotação nunca tocam o jsdom.
//
// A versão está FIXADA em 2.26.0 de propósito: 2.27+ derruba a produção com
// ERR_REQUIRE_ESM na Vercel. Não subir.

type Sanitizer = (html: string) => string;

let sanitizerPromise: Promise<Sanitizer> | null = null;

async function loadSanitizer(): Promise<Sanitizer> {
  const t0 = performance.now();
  const mod = await import("isomorphic-dompurify");
  if (process.env.PERF_LOG === "1") {
    console.log(
      `[perf] jsdom/DOMPurify carregado sob demanda em ${Math.round(
        performance.now() - t0
      )}ms (uma vez por processo)`
    );
  }
  // 2.26.0 é CJS; conforme o interop do bundler o objeto pode vir em `default`.
  const DOMPurify = ((mod as unknown as { default?: unknown }).default ??
    mod) as typeof import("isomorphic-dompurify").default;

  // Todo link de anotação abre em NOVA aba (não tirar o usuário do sistema),
  // com rel de segurança. O DOMPurify remove `target` por padrão, então o hook
  // (re)aplica depois da sanitização — vale também para anotações antigas.
  // Registrado UMA vez, aqui dentro, porque esta função só roda uma vez por
  // processo (o resultado fica memoizado em `sanitizerPromise`).
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  return (html: string) => DOMPurify.sanitize(html);
}

// Ponto ÚNICO de sanitização do HTML de anotações — leitura interna
// (loadCompanyNotes) e portal do cliente (passo 25). Devolve a função de
// sanitizar já pronta, para quem tem VÁRIOS HTMLs pagar o carregamento uma vez
// só e depois sanitizar em laço, de forma síncrona.
//
// Chame apenas quando houver HTML de verdade para limpar — assim uma tela sem
// anotações não carrega o jsdom.
export function getNoteSanitizer(): Promise<Sanitizer> {
  if (!sanitizerPromise) sanitizerPromise = loadSanitizer();
  return sanitizerPromise;
}

// Conveniência para um HTML avulso. Mesma força de sanitização e mesmo hook.
export async function sanitizeNoteHtml(html: string): Promise<string> {
  const sanitize = await getNoteSanitizer();
  return sanitize(html);
}

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
  // Empresa sem anotação nenhuma: sai antes de tocar no jsdom.
  if (rows.length === 0) return [];

  // Carrega o sanitizador em PARALELO com a resolução de nomes — o custo do
  // jsdom (na primeira vez do processo) deixa de ser uma onda extra.
  const [people, sanitize] = await Promise.all([
    resolvePeople(supabase, rows.flatMap((r) => [r.author_id, r.updated_by])),
    getNoteSanitizer(),
  ]);

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
    // conteúdo é exposto ao cliente externo no portal do passo 25).
    contentHtml: sanitize(r.content_html),
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
