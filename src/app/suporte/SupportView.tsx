"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  MessageSquare,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { formatBytes } from "@/lib/format";
import type { NoteAttachmentMeta, NoteAttachmentView } from "@/lib/notes";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import Lightbox from "@/components/Lightbox";
import Modal from "@/components/Modal";
import { fetchTicketReplies } from "./actions";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  ShowMore,
  usePaged,
  norm,
} from "@/components/ListControls";
import { btnPrimary } from "@/lib/ui";
import {
  URGENCY_UI,
  ISSUE_TYPE_UI,
  STATUS_UI,
  URGENCY_ORDER,
  ISSUE_TYPE_ORDER,
  STATUS_ORDER,
  isOpenStatus,
  type SupportTicketView,
  type TicketReplyView,
  type TicketStatus,
} from "@/lib/support";

// O formulário (e, por dentro, o editor TipTap) só entram no bundle quando o
// usuário clica em "Abrir chamado".
const TicketFormLazy = dynamic(() => import("./TicketForm"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-subtle shadow-card">
      Carregando…
    </div>
  ),
});

// O editor de resposta (mesmo NoteEditor da Fatia 1) só entra no bundle quando
// alguém abre o campo de responder/editar — o detalhe não abre pesado.
const NoteEditorLazy = dynamic(
  () => import("@/components/company-central/NoteEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-subtle shadow-card">
        Carregando editor…
      </div>
    ),
  }
);

// Traduz o erro do Supabase numa causa CLASSIFICADA (permissão / campo /
// sessão), nunca chutando — mesmo espírito do resto do projeto.
function classifyMutationError(err: {
  code?: string;
  message?: string;
}): string {
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (code === "42501" || msg.includes("row-level security")) {
    return "Você não tem permissão para isso (apenas o autor edita a própria resposta).";
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

function AttachmentIcon({ name }: { name: string }) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={15} className="shrink-0 text-fg-muted" />;
  }
  return <FileText size={15} className="shrink-0 text-fg-muted" />;
}

// Anexos (note-files) do contexto do chamado ou de uma resposta: abrem/baixam
// em nova aba, com ícone por tipo e tamanho.
function AttachmentList({ items }: { items: NoteAttachmentView[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
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

// Chip colorido com o texto SEMPRE junto da cor (nunca a cor sozinha).
function Chip({ ui }: { ui: { label: string; chip: string; dot: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${ui.chip}`}
    >
      <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
      {ui.label}
    </span>
  );
}

// Menu de status direto na linha (espírito da etiqueta do Monday): mostra o
// status atual como chip-botão; clicar abre a lista dos cinco valores. Fecha ao
// clicar fora. A troca é otimista (feita no pai) com reversão em caso de erro.
function StatusMenu({
  status,
  onChange,
}: {
  status: TicketStatus;
  onChange: (next: TicketStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // O painel vai para um PORTAL no body (posição fixed ancorada no botão): as
  // linhas vivem dentro de um contêiner overflow-hidden que, de outra forma,
  // recortaria o menu (mesmo motivo do lightbox/Modal usarem portal). Abre para
  // CIMA se não couber abaixo (linha no fim da lista) e não vaza à direita.
  const PANEL_W = 208; // w-52
  const PANEL_H = 220; // 5 itens + respiro (estimativa segura)
  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const top =
      window.innerHeight - r.bottom < PANEL_H
        ? Math.max(8, r.top - PANEL_H - 4)
        : r.bottom + 4;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    setCoords({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        !btnRef.current?.contains(t) &&
        !panelRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    // Rolar/redimensionar reposiciona ou fecha (o âncora se move).
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const ui = STATUS_UI[status];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) place();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Alterar status"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${ui.chip}`}
      >
        <span className={`h-2 w-2 rounded-full ${ui.dot}`} aria-hidden="true" />
        {ui.label}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            onClick={(e) => e.stopPropagation()}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-overlay w-52 rounded-lg border border-line bg-surface p-1 shadow-pop"
          >
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={s === status}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  if (s !== status) onChange(s);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                  s === status ? "font-semibold text-fg" : "text-fg-muted"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${STATUS_UI[s].dot}`}
                  aria-hidden="true"
                />
                {STATUS_UI[s].label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function TicketRow({
  ticket,
  canManage,
  onOpen,
  onStatusChange,
  onDelete,
}: {
  ticket: SupportTicketView;
  canManage: boolean;
  onOpen: () => void;
  onStatusChange: (next: TicketStatus) => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="flex cursor-pointer flex-col gap-2 border-t border-line px-3 py-3 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-risd sm:flex-row sm:items-center sm:gap-4"
      >
        <p className="min-w-0 flex-1 truncate font-medium text-fg" title={ticket.title}>
          {ticket.title}
        </p>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Chip ui={URGENCY_UI[ticket.urgency]} />
          <Chip ui={ISSUE_TYPE_UI[ticket.issueType]} />
          <StatusMenu status={ticket.status} onChange={onStatusChange} />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle sm:shrink-0 sm:justify-end">
          <span className="inline-flex items-center gap-1.5">
            <Avatar
              name={ticket.authorName}
              url={ticket.authorAvatarUrl}
              size={20}
            />
            {ticket.authorFirstName}
          </span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">
            {formatDateTime(ticket.createdAtISO)}
          </span>
          {ticket.replyCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 font-medium text-fg-muted"
              title={`${ticket.replyCount} ${
                ticket.replyCount === 1 ? "resposta" : "respostas"
              }`}
            >
              <MessageSquare size={12} aria-hidden="true" />
              {ticket.replyCount}
            </span>
          )}
          {canManage && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Excluir chamado"
              title="Excluir chamado"
              className="ml-1 rounded-md px-1.5 py-1 font-medium text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Excluir
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// Grupo colapsável (Abertos / Finalizados). A contagem no cabeçalho vem do count
// no banco (props), NÃO do tamanho do array — a lista é paginada.
function Group({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-risd"
      >
        {open ? (
          <ChevronDown size={18} className="text-fg-muted" aria-hidden="true" />
        ) : (
          <ChevronRight size={18} className="text-fg-muted" aria-hidden="true" />
        )}
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-muted">
          {count}
        </span>
      </button>
      {open && children}
    </section>
  );
}

// Respostas do chamado (Fatia 2): "Responder" no topo abre o editor; abaixo, as
// respostas em ordem cronológica DECRESCENTE. Carregadas sob demanda via server
// action (sanitização no servidor). Responder NÃO mexe no status — o menu da
// Fatia 1 segue sendo o único caminho. Sem excluir (append-only).
function RepliesSection({
  ticketId,
  userId,
  onChanged,
}: {
  ticketId: string;
  userId: string;
  onChanged: () => void;
}) {
  const [replies, setReplies] = useState<TicketReplyView[] | null>(null); // null = carregando
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);

  const reload = useCallback(async () => {
    try {
      setReplies(await fetchTicketReplies(ticketId));
      setLoadError(null);
    } catch {
      setLoadError("Não foi possível carregar as respostas.");
    }
  }, [ticketId]);

  useEffect(() => {
    setReplies(null);
    void reload();
  }, [reload]);

  async function createReply(
    html: string,
    _visible: boolean,
    attachments: NoteAttachmentMeta[]
  ) {
    const supabase = createClient();
    const { error } = await supabase.from("support_ticket_replies").insert({
      ticket_id: ticketId,
      body_html: html,
      attachments,
      author_id: userId,
    });
    if (error) return { error: classifyMutationError(error) };
    setComposing(false);
    await reload();
    onChanged(); // revalida a contagem da lista
  }

  async function updateReply(
    id: string,
    html: string,
    _visible: boolean,
    attachments: NoteAttachmentMeta[]
  ) {
    const supabase = createClient();
    const { error } = await supabase
      .from("support_ticket_replies")
      .update({ body_html: html, attachments })
      .eq("id", id);
    if (error) return { error: classifyMutationError(error) };
    setEditingId(null);
    await reload();
    onChanged();
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

  return (
    <section className="border-t border-line pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">
          Respostas
          {replies && replies.length > 0 ? ` (${replies.length})` : ""}
        </h3>
        {!composing && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setComposing(true);
            }}
            className={btnPrimary}
          >
            Responder
          </button>
        )}
      </div>

      {composing && (
        <div className="mb-4">
          <NoteEditorLazy
            userId={userId}
            showClientVisibility={false}
            saveLabel="Enviar"
            onSave={createReply}
            onCancel={() => setComposing(false)}
          />
        </div>
      )}

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

      {replies && replies.length === 0 && !composing && (
        <p className="text-sm text-fg-subtle">Nenhuma resposta ainda.</p>
      )}

      {replies && replies.length > 0 && (
        <ul className="space-y-3">
          {replies.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-line bg-surface-2/40 p-3"
            >
              {editingId === r.id ? (
                <NoteEditorLazy
                  userId={userId}
                  initialHTML={r.bodyHtml}
                  initialAttachments={r.attachments.map(
                    ({ path, name, size, mime }) => ({ path, name, size, mime })
                  )}
                  showClientVisibility={false}
                  saveLabel="Salvar alterações"
                  onSave={(html, vis, atts) => updateReply(r.id, html, vis, atts)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
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
                    {r.authorId === userId && (
                      <button
                        type="button"
                        onClick={() => {
                          setComposing(false);
                          setEditingId(r.id);
                        }}
                        className="ml-auto rounded-md px-2 py-1 font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                      >
                        Editar
                      </button>
                    )}
                  </div>

                  <div
                    className="rich-text note-view"
                    onClick={onImageClick}
                    // Sanitizado no servidor (loadTicketReplies → getNoteSanitizer).
                    dangerouslySetInnerHTML={{ __html: r.bodyHtml }}
                  />

                  {r.attachments.length > 0 && (
                    <div className="mt-3">
                      <AttachmentList items={r.attachments} />
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
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

// Detalhe do chamado: contexto renderizado + metadados. Somente leitura; a troca
// de status é na linha. O botão de excluir aparece só para autor/admin.
function DetailModal({
  ticket,
  canManage,
  userId,
  onClose,
  onDelete,
  onRepliesChanged,
}: {
  ticket: SupportTicketView;
  canManage: boolean;
  userId: string;
  onClose: () => void;
  onDelete: () => void;
  onRepliesChanged: () => void;
}) {
  // Imagens do contexto ampliam num lightbox (mesmo mecanismo das anotações): o
  // handler pega TODAS as imagens do bloco para navegar entre elas.
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);

  return (
    <Modal open onClose={onClose} labelledBy="ticket-detail-title" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div>
          <h2
            id="ticket-detail-title"
            className="text-lg font-semibold tracking-tight text-fg"
          >
            {ticket.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip ui={URGENCY_UI[ticket.urgency]} />
            <Chip ui={ISSUE_TYPE_UI[ticket.issueType]} />
            <Chip ui={STATUS_UI[ticket.status]} />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1.5">
              Aberto por
              <Avatar
                name={ticket.authorName}
                url={ticket.authorAvatarUrl}
                size={18}
              />
              <span className="font-medium text-fg-muted">
                {ticket.authorName}
              </span>
            </span>
            em {formatDateTime(ticket.createdAtISO)}
            {ticket.updatedAtISO && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  editado por {ticket.updatedByName ?? "—"} em{" "}
                  {formatDateTime(ticket.updatedAtISO)}
                </span>
              </>
            )}
            {ticket.finishedAtISO && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-700 dark:text-emerald-300">
                  finalizado em {formatDateTime(ticket.finishedAtISO)}
                </span>
              </>
            )}
          </p>
        </div>

        <div
          className="rich-text note-view border-t border-line pt-4"
          onClick={(e) => {
            const t = e.target;
            if (t instanceof HTMLImageElement && t.src) {
              const imgs = Array.from(
                e.currentTarget.querySelectorAll("img")
              ).map((i) => i.src);
              setLightbox({
                images: imgs,
                index: Math.max(0, imgs.indexOf(t.src)),
              });
            }
          }}
          // Sanitizado no servidor (loadSupportTickets → getNoteSanitizer).
          dangerouslySetInnerHTML={{ __html: ticket.contextHtml }}
        />

        {ticket.attachments.length > 0 && (
          <div className="border-t border-line pt-4">
            <AttachmentList items={ticket.attachments} />
          </div>
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

        <RepliesSection
          ticketId={ticket.id}
          userId={userId}
          onChanged={onRepliesChanged}
        />

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Excluir
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function SupportView({
  tickets,
  counts,
  truncated,
  userId,
  isAdmin,
}: {
  tickets: SupportTicketView[];
  counts: { open: number; finished: number };
  truncated: boolean;
  userId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Estado local dos chamados, semeado das props e ressincronizado quando o
  // servidor devolve nova carga (após refresh). Permite a troca de status
  // otimista (mover de grupo na hora) com reversão.
  const [rows, setRows] = useState(tickets);
  useEffect(() => setRows(tickets), [tickets]);

  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<SupportTicketView | null>(null);
  const [deleting, setDeleting] = useState<SupportTicketView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState("");
  const [issueFilter, setIssueFilter] = useState("");

  const [openExpanded, setOpenExpanded] = useState(true);
  const [finishedExpanded, setFinishedExpanded] = useState(true);

  const canManage = (t: SupportTicketView) => isAdmin || t.createdById === userId;

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return rows.filter((t) => {
      if (q && !norm(t.title).includes(q)) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (urgencyFilter && t.urgency !== urgencyFilter) return false;
      if (issueFilter && t.issueType !== issueFilter) return false;
      return true;
    });
  }, [rows, query, statusFilter, urgencyFilter, issueFilter]);

  const openTickets = useMemo(
    () => filtered.filter((t) => isOpenStatus(t.status)),
    [filtered]
  );
  const finishedTickets = useMemo(
    () => filtered.filter((t) => !isOpenStatus(t.status)),
    [filtered]
  );

  const openPage = usePaged(openTickets);
  const finishedPage = usePaged(finishedTickets);

  async function changeStatus(t: SupportTicketView, next: TicketStatus) {
    const prev = rows;
    const nowISO = new Date().toISOString();
    // Otimista: reflete o novo status (e o grupo derivado) na hora.
    setRows((rs) =>
      rs.map((r) =>
        r.id === t.id
          ? {
              ...r,
              status: next,
              finishedAtISO: next === "finalizado" ? nowISO : null,
            }
          : r
      )
    );
    setDetail((d) =>
      d && d.id === t.id
        ? { ...d, status: next, finishedAtISO: next === "finalizado" ? nowISO : null }
        : d
    );
    setError(null);

    const supabase = createClient();
    const { error: err } = await supabase
      .from("support_tickets")
      .update({ status: next })
      .eq("id", t.id);
    if (err) {
      setRows(prev); // reversão da lista
      // e do detalhe aberto (volta ao status/finished originais de `t`).
      setDetail((d) =>
        d && d.id === t.id
          ? { ...d, status: t.status, finishedAtISO: t.finishedAtISO }
          : d
      );
      setError(`Não foi possível alterar o status: ${err.message}`);
      return;
    }
    // Ressincroniza contagens dos grupos e campos de auditoria a partir do banco.
    startTransition(() => router.refresh());
  }

  async function deleteTicket(t: SupportTicketView) {
    const supabase = createClient();
    const { error: err } = await supabase
      .from("support_tickets")
      .delete()
      .eq("id", t.id);
    if (err) return { error: err.message };
    // Melhor esforço: limpa anexos do Storage (a política só deixa apagar da
    // própria pasta; anexo alheio apagado por admin fica órfão, sem quebrar).
    const paths = t.attachments.map((a) => a.path);
    if (paths.length > 0) {
      void supabase.storage.from("note-files").remove(paths);
    }
    setDetail((d) => (d && d.id === t.id ? null : d));
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {counts.open + counts.finished} chamado
          {counts.open + counts.finished === 1 ? "" : "s"} no total
        </p>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={btnPrimary}
          >
            Abrir chamado
          </button>
        )}
      </div>

      {creating && (
        <TicketFormLazy
          userId={userId}
          onCreated={() => {
            setCreating(false);
            startTransition(() => router.refresh());
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {truncated && (
        <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg-subtle">
          Exibindo os chamados mais recentes (limite de desempenho). A busca e os
          filtros abaixo agem sobre estes.
        </p>
      )}

      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por título…"
        />
        <SelectFilter
          value={statusFilter}
          onChange={setStatusFilter}
          allLabel="Qualquer status"
          ariaLabel="Filtrar por status"
          options={STATUS_ORDER.map((s) => ({
            value: s,
            label: STATUS_UI[s].label,
          }))}
        />
        <SelectFilter
          value={urgencyFilter}
          onChange={setUrgencyFilter}
          allLabel="Qualquer urgência"
          ariaLabel="Filtrar por urgência"
          options={URGENCY_ORDER.map((u) => ({
            value: u,
            label: URGENCY_UI[u].label,
          }))}
        />
        <SelectFilter
          value={issueFilter}
          onChange={setIssueFilter}
          allLabel="Qualquer tipo de B.O"
          ariaLabel="Filtrar por tipo de B.O"
          options={ISSUE_TYPE_ORDER.map((t) => ({
            value: t,
            label: ISSUE_TYPE_UI[t].label,
          }))}
        />
      </FilterBar>

      {counts.open + counts.finished === 0 ? (
        <EmptyState>
          Nenhum chamado ainda. Clique em “Abrir chamado” para registrar o
          primeiro.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <Group
            title="Tickets Abertos"
            count={counts.open}
            open={openExpanded}
            onToggle={() => setOpenExpanded((v) => !v)}
          >
            {openTickets.length === 0 ? (
              <p className="border-t border-line px-3 py-6 text-center text-sm text-fg-subtle">
                Nenhum chamado aberto{filtered.length !== rows.length ? " nos filtros" : ""}.
              </p>
            ) : (
              <>
                <ul>
                  {openPage.visible.map((t) => (
                    <TicketRow
                      key={t.id}
                      ticket={t}
                      canManage={canManage(t)}
                      onOpen={() => setDetail(t)}
                      onStatusChange={(next) => changeStatus(t, next)}
                      onDelete={() => setDeleting(t)}
                    />
                  ))}
                </ul>
                {openPage.hasMore && (
                  <div className="p-3">
                    <ShowMore
                      remaining={openPage.remaining}
                      onClick={openPage.showMore}
                    />
                  </div>
                )}
              </>
            )}
          </Group>

          <Group
            title="Tickets Finalizados"
            count={counts.finished}
            open={finishedExpanded}
            onToggle={() => setFinishedExpanded((v) => !v)}
          >
            {finishedTickets.length === 0 ? (
              <p className="border-t border-line px-3 py-6 text-center text-sm text-fg-subtle">
                Nenhum chamado finalizado{filtered.length !== rows.length ? " nos filtros" : ""}.
              </p>
            ) : (
              <>
                <ul>
                  {finishedPage.visible.map((t) => (
                    <TicketRow
                      key={t.id}
                      ticket={t}
                      canManage={canManage(t)}
                      onOpen={() => setDetail(t)}
                      onStatusChange={(next) => changeStatus(t, next)}
                      onDelete={() => setDeleting(t)}
                    />
                  ))}
                </ul>
                {finishedPage.hasMore && (
                  <div className="p-3">
                    <ShowMore
                      remaining={finishedPage.remaining}
                      onClick={finishedPage.showMore}
                    />
                  </div>
                )}
              </>
            )}
          </Group>
        </div>
      )}

      {detail && (
        <DetailModal
          ticket={detail}
          canManage={canManage(detail)}
          userId={userId}
          onClose={() => setDetail(null)}
          onDelete={() => {
            setDeleting(detail);
          }}
          onRepliesChanged={() => startTransition(() => router.refresh())}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? deleteTicket(deleting) : undefined)}
        title="Excluir chamado"
        description={
          deleting ? (
            <>
              O chamado <strong>{deleting.title}</strong> será removido
              permanentemente.
            </>
          ) : undefined
        }
        confirmLabel="Excluir"
      />
    </div>
  );
}
