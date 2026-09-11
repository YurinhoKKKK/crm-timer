"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import dynamic from "next/dynamic";
import { CornerUpLeft, FileSpreadsheet, FileText, Reply, X } from "lucide-react";
import type { NoteAttachmentMeta, NoteAttachmentView } from "@/lib/notes";
import type { MentionContext } from "@/lib/mentions";
import { formatBytes } from "@/lib/format";
import { btnPrimary } from "@/lib/ui";
import Avatar from "@/components/Avatar";
import Lightbox from "@/components/Lightbox";

// O editor rich text (mesmo NoteEditor das atualizações/chamados, com TipTap por
// dentro) só entra no bundle quando alguém abre um campo de resposta/edição —
// nunca no topo de módulo, para não arrastar o peso na primeira pintura.
const NoteEditorLazy = dynamic(
  () => import("@/components/company-central/NoteEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-line bg-surface p-4 text-sm text-fg-subtle shadow-card">
        Carregando editor…
      </div>
    ),
  }
);

// Forma normalizada de uma resposta, compartilhada pelos dois contextos
// (chamados de suporte e atualizações da empresa). O componente não precisa
// saber a qual conversa pertence — a inserção/edição já carrega esse contexto.
export type ReplyView = {
  id: string;
  parentId: string | null; // null = resposta à raiz da conversa
  bodyHtml: string; // já sanitizado no servidor
  attachments: NoteAttachmentView[];
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  createdAtISO: string;
  editedAtISO: string | null;
};

// Traduz o erro do Supabase numa causa CLASSIFICADA (permissão / campo /
// sessão), nunca chutando — mesmo espírito do resto do projeto. Compartilhado
// pelos adaptadores dos dois contextos.
export function classifyReplyError(err: {
  code?: string;
  message?: string;
}): string {
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (code === "42501" || msg.includes("row-level security")) {
    return "Você não tem permissão para isso (apenas o autor edita a própria resposta).";
  }
  if (msg.includes("resposta-pai") || msg.includes("ciclo")) {
    return "Direcionamento inválido — recarregue a conversa e tente de novo.";
  }
  if (["23514", "23502", "22001", "23503"].includes(code)) {
    return "Conteúdo inválido — revise a resposta e tente de novo.";
  }
  if (code === "401" || msg.includes("jwt") || msg.includes("session")) {
    return "Sua sessão expirou. Recarregue a página e entre novamente.";
  }
  return err.message ?? "Não foi possível concluir.";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Primeiras palavras do corpo (texto puro) para a referência "em resposta a
// Fulano: …". Curto de propósito — é uma âncora, não uma prévia.
function snippet(html: string, max = 46): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "mensagem";
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function AttachmentIcon({ name }: { name: string }) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={15} className="shrink-0 text-fg-muted" />;
  }
  return <FileText size={15} className="shrink-0 text-fg-muted" />;
}

function AttachmentList({ items }: { items: NoteAttachmentView[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.path} className="max-w-full">
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir/baixar ${a.name}`}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <AttachmentIcon name={a.name} />
            <span className="min-w-0 truncate">{a.name}</span>
            <span className="shrink-0 text-xs text-fg-subtle">
              {formatBytes(a.size)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// Monta os fios da conversa a partir da lista plana. Cada resposta pertence à
// sua RAIZ (o ancestral cujo parent_id é nulo); a tela exibe no máximo UM nível
// de indentação, então TODA a descendência de uma raiz é achatada nesse único
// nível — o "quem respondeu quem" não se perde porque cada resposta com pai
// carrega a referência clicável ao pai real.
function buildThreads(replies: ReplyView[]) {
  const byId = new Map(replies.map((r) => [r.id, r]));

  const rootOf = (start: ReplyView): string => {
    let cur = start;
    const seen = new Set<string>();
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId)!;
    }
    return cur.id;
  };

  const roots: ReplyView[] = [];
  const descendants = new Map<string, ReplyView[]>();

  for (const r of replies) {
    // parent nulo — ou pai ausente (defensivo) — é raiz da conversa.
    if (!r.parentId || !byId.has(r.parentId)) {
      roots.push(r);
      if (!descendants.has(r.id)) descendants.set(r.id, []);
    }
  }
  for (const r of replies) {
    if (r.parentId && byId.has(r.parentId)) {
      const root = rootOf(r);
      const list = descendants.get(root) ?? [];
      list.push(r);
      descendants.set(root, list);
    }
  }

  // Raízes: conversa mais recente no topo (mantém o "novo em cima" do suporte).
  // Descendentes: ordem cronológica dentro do fio (leitura natural do sub-papo).
  roots.sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO));
  descendants.forEach((list) =>
    list.sort((a, b) => a.createdAtISO.localeCompare(b.createdAtISO))
  );

  return { byId, roots, descendants };
}

type Composing = { target: string | null } | null;

// Conversa encadeada compartilhada pelos chamados de suporte E pelas
// atualizações da empresa (mesmo componente, não duas implementações). O
// componente é agnóstico de origem: recebe como carregar/inserir/editar via
// props. Autoria e integridade do direcionamento ficam no banco (RLS +
// triggers); aqui só desenhamos o fio e resolvemos o "em resposta a".
export default function ReplyThread({
  userId,
  load,
  insert,
  update,
  onChanged,
  emptyText = "Nenhuma resposta ainda.",
  mentionContext,
}: {
  userId: string;
  load: () => Promise<ReplyView[]>;
  insert: (
    parentId: string | null,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error?: string | null }>;
  update: (
    id: string,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) => Promise<{ error?: string | null }>;
  onChanged?: () => void;
  emptyText?: string;
  // Habilita @menção no editor das respostas (repassado ao NoteEditor).
  mentionContext?: MentionContext;
}) {
  const [replies, setReplies] = useState<ReplyView[] | null>(null); // null = carregando
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composing, setComposing] = useState<Composing>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setReplies(await load());
      setLoadError(null);
    } catch {
      setLoadError("Não foi possível carregar as respostas.");
    }
  }, [load]);

  useEffect(() => {
    setReplies(null);
    void reload();
  }, [reload]);

  async function doCreate(
    target: string | null,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) {
    const res = await insert(target, html, attachments);
    if (res?.error) return { error: res.error };
    setComposing(null);
    await reload();
    onChanged?.();
  }

  async function doUpdate(
    id: string,
    html: string,
    attachments: NoteAttachmentMeta[]
  ) {
    const res = await update(id, html, attachments);
    if (res?.error) return { error: res.error };
    setEditingId(null);
    await reload();
    onChanged?.();
  }

  // Rola até a mensagem-alvo (dentro DESTE fio) e a destaca por um instante.
  function scrollToReply(id: string) {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-reply="${id}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    window.setTimeout(
      () => setHighlightId((h) => (h === id ? null : h)),
      1600
    );
  }

  function onImageClick(e: MouseEvent<HTMLDivElement>) {
    const t = e.target;
    if (t instanceof HTMLImageElement && t.src) {
      const imgs = Array.from(e.currentTarget.querySelectorAll("img")).map(
        (i) => i.src
      );
      setLightbox({ images: imgs, index: Math.max(0, imgs.indexOf(t.src)) });
    }
  }

  function startReply(target: string | null) {
    setEditingId(null);
    setComposing({ target });
  }

  const byId =
    replies != null ? new Map(replies.map((r) => [r.id, r])) : new Map();

  // Editor de composição/edição. É uma FUNÇÃO que devolve JSX (não um
  // componente aninhado) de propósito: assim o React reconcilia por posição e
  // não remonta o NoteEditor a cada re-render (senão perderia foco/conteúdo).
  function renderComposer(target: string | null) {
    const parent = target ? (byId.get(target) as ReplyView | undefined) : null;
    return (
      <div className="mt-2 rounded-xl border border-line bg-surface-2/40 p-3">
        {parent && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
            <span className="inline-flex min-w-0 items-center gap-1 text-fg-muted">
              <CornerUpLeft size={12} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">
                Respondendo a{" "}
                <span className="font-medium text-fg">{parent.authorName}</span>
                : {snippet(parent.bodyHtml)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setComposing(null)}
              aria-label="Cancelar direcionamento"
              title="Cancelar direcionamento"
              className="shrink-0 rounded p-0.5 text-fg-subtle transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <NoteEditorLazy
          userId={userId}
          showClientVisibility={false}
          showAreas={false}
          mentionContext={mentionContext}
          toolbarOffset="0px"
          saveLabel="Enviar"
          onSave={(html, _v, atts) => doCreate(target, html, atts)}
          onCancel={() => setComposing(null)}
        />
      </div>
    );
  }

  function renderReply(r: ReplyView) {
    const parent = r.parentId
      ? (byId.get(r.parentId) as ReplyView | undefined)
      : undefined;
    const isEditing = editingId === r.id;
    return (
      <div key={r.id}>
        <div
          data-reply={r.id}
          className={`rounded-xl border bg-surface-2/40 p-3 transition ${
            highlightId === r.id
              ? "border-risd ring-2 ring-risd ring-offset-2 ring-offset-surface"
              : "border-line"
          }`}
        >
          {isEditing ? (
            <NoteEditorLazy
              userId={userId}
              initialHTML={r.bodyHtml}
              initialAttachments={r.attachments.map(
                ({ path, name, size, mime }) => ({ path, name, size, mime })
              )}
              showClientVisibility={false}
              showAreas={false}
              mentionContext={mentionContext}
              toolbarOffset="0px"
              saveLabel="Salvar alterações"
              onSave={(html, _v, atts) => doUpdate(r.id, html, atts)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                  <Avatar
                    name={r.authorName}
                    url={r.authorAvatarUrl}
                    size={20}
                  />
                  {r.authorName}
                </span>
                <span className="text-fg-subtle">
                  em {formatDateTime(r.createdAtISO)}
                </span>
                {r.editedAtISO && (
                  <span className="italic text-fg-subtle">
                    · editado em {formatDateTime(r.editedAtISO)}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startReply(r.id)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                  >
                    <Reply size={13} aria-hidden="true" />
                    Responder
                  </button>
                  {r.authorId === userId && (
                    <button
                      type="button"
                      onClick={() => {
                        setComposing(null);
                        setEditingId(r.id);
                      }}
                      className="rounded-md px-2 py-1 font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                    >
                      Editar
                    </button>
                  )}
                </span>
              </div>

              {/* Referência ao pai: só quando responde a OUTRA resposta (não à
                  raiz). Clicar rola até a mensagem original e a destaca. */}
              {parent && (
                <button
                  type="button"
                  onClick={() => scrollToReply(parent.id)}
                  title={`Ir até a resposta de ${parent.authorName}`}
                  className="mb-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                >
                  <CornerUpLeft size={11} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    em resposta a{" "}
                    <span className="font-medium">{parent.authorName}</span>:{" "}
                    {snippet(parent.bodyHtml)}
                  </span>
                </button>
              )}

              <div
                className="rich-text note-view text-sm"
                onClick={onImageClick}
                // Sanitizado no servidor (loadTicketReplies/loadNoteReplies).
                dangerouslySetInnerHTML={{ __html: r.bodyHtml }}
              />

              <AttachmentList items={r.attachments} />
            </>
          )}
        </div>

        {composing?.target === r.id && renderComposer(r.id)}
      </div>
    );
  }

  const threads = replies ? buildThreads(replies) : null;

  return (
    <section ref={containerRef} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-fg">
          Respostas
          {replies && replies.length > 0 ? ` (${replies.length})` : ""}
        </h4>
        {/* Some só enquanto a composição À CONVERSA (raiz) está aberta logo
            abaixo — nos demais estados o botão continua disponível. */}
        {composing?.target !== null && (
          <button
            type="button"
            onClick={() => startReply(null)}
            className={btnPrimary}
          >
            Responder
          </button>
        )}
      </div>

      {/* Composição de uma resposta à conversa (raiz). */}
      {composing?.target === null && renderComposer(null)}

      {loadError && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {loadError}
        </p>
      )}

      {replies === null && !loadError && (
        <p className="text-sm text-fg-subtle">Carregando respostas…</p>
      )}

      {replies && replies.length === 0 && composing === null && (
        <p className="text-sm text-fg-subtle">{emptyText}</p>
      )}

      {threads && threads.roots.length > 0 && (
        <ul className="space-y-3">
          {threads.roots.map((root) => {
            const kids = threads.descendants.get(root.id) ?? [];
            return (
              <li key={root.id} className="space-y-2">
                {renderReply(root)}
                {kids.length > 0 && (
                  <div className="ml-4 space-y-2 border-l border-line pl-3 sm:ml-6 sm:pl-4">
                    {kids.map((k) => renderReply(k))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(i) =>
            setLightbox((prev) => (prev ? { ...prev, index: i } : prev))
          }
        />
      )}
    </section>
  );
}
