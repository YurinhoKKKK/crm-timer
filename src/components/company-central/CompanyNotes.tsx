"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, X } from "lucide-react";
import type { CompanyNoteView, NoteAttachmentMeta } from "@/lib/notes";
import { createClient } from "@/lib/supabase-browser";
import { formatBytes } from "@/lib/format";
import ConfirmDialog from "@/components/ConfirmDialog";
import Avatar from "@/components/Avatar";
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

// O editor (TipTap) só entra no bundle quando alguém cria/edita.
const NoteEditor = dynamic(() => import("./NoteEditor"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-subtle shadow-card">
      Carregando editor…
    </div>
  ),
});

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

// Texto puro da anotação (para a busca por conteúdo).
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function AttachmentIcon({ name }: { name: string }) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={15} className="shrink-0 text-fg-muted" />;
  }
  return <FileText size={15} className="shrink-0 text-fg-muted" />;
}

// Visualizador de imagem ampliada (lightbox): renderizado via PORTAL no body —
// fora dos containers da lista/editor, então nenhum ancestral com
// transform/filter/overflow quebra o position:fixed nem a ordem das camadas.
// z-[100] fica acima de todo o sistema (sidebar z-40, header z-20, modais z-50).
// Fecha no ESC, no clique fora e no X; setas navegam entre as imagens da mesma
// anotação; clicar na imagem alterna zoom (tamanho real com rolagem).
function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const src = images[index];
  const many = images.length > 1;

  // Trocar de imagem sempre volta ao enquadramento normal.
  useEffect(() => setZoomed(false), [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (many && e.key === "ArrowLeft") {
        onNavigate((index - 1 + images.length) % images.length);
      }
      if (many && e.key === "ArrowRight") {
        onNavigate((index + 1) % images.length);
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onNavigate, index, images.length, many]);

  if (typeof document === "undefined" || !src) return null;

  const navBtn =
    "rounded-full bg-white/10 p-2 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-gunmetal/90"
      role="dialog"
      aria-modal="true"
      aria-label="Imagem ampliada"
    >
      {/* Camada da imagem: clique fora fecha; clique na imagem alterna zoom */}
      {zoomed ? (
        <div className="absolute inset-0 z-10 overflow-auto p-6" onClick={onClose}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(false);
            }}
            className="mx-auto cursor-zoom-out rounded-lg shadow-pop"
            style={{ maxWidth: "none" }}
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center p-6"
          onClick={onClose}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(true);
            }}
            className="max-h-[90vh] max-w-[92vw] cursor-zoom-in rounded-lg object-contain shadow-pop"
          />
        </div>
      )}

      {/* Controles sempre ACIMA da imagem */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        title="Fechar (Esc)"
        className={`absolute right-4 top-4 z-20 ${navBtn}`}
      >
        <X size={22} />
      </button>

      {many && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index - 1 + images.length) % images.length);
            }}
            aria-label="Imagem anterior"
            title="Anterior (←)"
            className={`absolute left-3 top-1/2 z-20 -translate-y-1/2 ${navBtn}`}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index + 1) % images.length);
            }}
            aria-label="Próxima imagem"
            title="Próxima (→)"
            className={`absolute right-3 top-1/2 z-20 -translate-y-1/2 ${navBtn}`}
          >
            <ChevronRight size={24} />
          </button>
          <span className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium tabular-nums text-white">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>,
    document.body
  );
}

// Altura máxima do texto retraído (~9 linhas). Só retrai se passar com folga.
const COLLAPSE_PX = 208;

// Corpo da anotação: retrai textos longos por padrão ("Ver mais"/"Ver menos",
// com fade no corte) e abre o lightbox ao clicar numa imagem. O ResizeObserver
// re-mede quando as imagens carregam (a altura muda depois do primeiro render).
function NoteBody({
  html,
  onImageClick,
}: {
  html: string;
  onImageClick: (images: string[], index: number) => void;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const check = () => setOverflows(el.offsetHeight > COLLAPSE_PX + 48);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);

  const collapsed = overflows && !expanded;

  return (
    <div>
      <div
        className={collapsed ? "relative overflow-hidden" : undefined}
        style={collapsed ? { maxHeight: COLLAPSE_PX } : undefined}
      >
        <div
          ref={innerRef}
          className="rich-text note-view"
          onClick={(e) => {
            const t = e.target;
            if (t instanceof HTMLImageElement && t.src) {
              // Todas as imagens DESTA anotação, para navegar entre elas.
              const imgs = Array.from(
                e.currentTarget.querySelectorAll("img")
              ).map((i) => i.src);
              onImageClick(imgs, Math.max(0, imgs.indexOf(t.src)));
            }
          }}
          // Sanitizado no servidor (loadCompanyNotes → DOMPurify).
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface to-transparent"
          />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-sm font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {expanded ? "Ver menos" : "Ver mais"}
        </button>
      )}
    </div>
  );
}

type SortKey = "recentes" | "antigas";

function periodCutoff(p: string): number | null {
  const now = new Date();
  if (p === "hoje") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (p === "7d") return now.getTime() - 7 * 86400_000;
  if (p === "30d") return now.getTime() - 30 * 86400_000;
  return null;
}

// Seção de anotações da empresa (passo 24): busca por conteúdo/autor, filtros
// (autor, período, visibilidade, anexo/imagem), ordenação e paginação; textos
// longos retraídos; imagens ampliam em lightbox; documentos anexos com
// baixar/abrir. CRUD conforme permissão — cada um edita/exclui as próprias;
// admin, qualquer uma (a RLS cn_* garante isso no banco, aqui é só a interface).
export default function CompanyNotes({
  companyId,
  userId,
  isAdmin,
  notes,
}: {
  companyId: string;
  userId: string;
  isAdmin: boolean;
  notes: CompanyNoteView[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CompanyNoteView | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [period, setPeriod] = useState("");
  const [visibility, setVisibility] = useState("");
  const [has, setHas] = useState("");
  const [sort, setSort] = useState<SortKey>("recentes");

  // Pré-processa uma vez por carga: texto puro para busca + flags de conteúdo.
  const enriched = useMemo(
    () =>
      notes.map((n) => ({
        note: n,
        text: norm(`${stripTags(n.contentHtml)} ${n.authorName}`),
        hasImage: /<img[\s>]/i.test(n.contentHtml),
      })),
    [notes]
  );

  const authors = useMemo(
    () =>
      Array.from(new Set(notes.map((n) => n.authorName))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [notes]
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const cutoff = periodCutoff(period);
    const out = enriched
      .filter(({ note: n, text, hasImage }) => {
        if (q && !text.includes(q)) return false;
        if (author && n.authorName !== author) return false;
        if (cutoff !== null && new Date(n.createdAtISO).getTime() < cutoff)
          return false;
        if (visibility === "cliente" && !n.visibleToClient) return false;
        if (visibility === "interna" && n.visibleToClient) return false;
        if (has === "anexo" && n.attachments.length === 0) return false;
        if (has === "imagem" && !hasImage) return false;
        return true;
      })
      .map(({ note }) => note);
    out.sort((a, b) => {
      const cmp = a.createdAtISO.localeCompare(b.createdAtISO);
      return sort === "antigas" ? cmp : -cmp;
    });
    return out;
  }, [enriched, query, author, period, visibility, has, sort]);

  const { visible, hasMore, remaining, showMore } = usePaged(filtered);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function createNote(
    html: string,
    visibleToClient: boolean,
    attachments: NoteAttachmentMeta[]
  ) {
    const supabase = createClient();
    const { error } = await supabase.from("company_notes").insert({
      company_id: companyId,
      author_id: userId,
      content_html: html,
      visible_to_client: visibleToClient,
      attachments,
    });
    if (error) return { error: error.message };
    setCreating(false);
    refresh();
  }

  async function updateNote(
    id: string,
    html: string,
    visibleToClient: boolean,
    attachments: NoteAttachmentMeta[]
  ) {
    const supabase = createClient();
    const { error } = await supabase
      .from("company_notes")
      .update({
        content_html: html,
        visible_to_client: visibleToClient,
        attachments,
      })
      .eq("id", id);
    if (error) return { error: error.message };
    setEditingId(null);
    refresh();
  }

  async function deleteNote(note: CompanyNoteView) {
    const supabase = createClient();
    const { error } = await supabase
      .from("company_notes")
      .delete()
      .eq("id", note.id);
    if (error) return { error: error.message };
    // Melhor esforço: limpa os arquivos anexos do Storage (a política só deixa
    // apagar da própria pasta; se não der — ex.: admin apagando nota alheia —
    // o arquivo órfão fica, sem quebrar nada).
    const paths = note.attachments.map((a) => a.path);
    if (paths.length > 0) {
      void supabase.storage.from("note-files").remove(paths);
    }
    refresh();
  }

  const canManage = (n: CompanyNoteView) => isAdmin || n.authorId === userId;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {notes.length === 0
            ? "Nenhuma anotação ainda."
            : filtered.length === notes.length
              ? `${notes.length} anotaç${notes.length === 1 ? "ão" : "ões"}`
              : `${filtered.length} de ${notes.length} anotações`}
        </p>
        {!creating && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
            className={btnPrimary}
          >
            Nova anotação
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-4">
          <NoteEditor
            userId={userId}
            onSave={createNote}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {notes.length > 0 && (
        <FilterBar>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Buscar nas anotações…"
          />
          <SelectFilter
            value={author}
            onChange={setAuthor}
            allLabel="Todos os autores"
            ariaLabel="Filtrar por autor"
            options={authors.map((a) => ({ value: a, label: a }))}
          />
          <SelectFilter
            value={period}
            onChange={setPeriod}
            allLabel="Qualquer data"
            ariaLabel="Filtrar por período"
            options={[
              { value: "hoje", label: "Hoje" },
              { value: "7d", label: "Últimos 7 dias" },
              { value: "30d", label: "Últimos 30 dias" },
            ]}
          />
          <SelectFilter
            value={visibility}
            onChange={setVisibility}
            allLabel="Qualquer visibilidade"
            ariaLabel="Filtrar por visibilidade"
            options={[
              { value: "interna", label: "Internas" },
              { value: "cliente", label: "Visíveis ao cliente" },
            ]}
          />
          <SelectFilter
            value={has}
            onChange={setHas}
            allLabel="Qualquer conteúdo"
            ariaLabel="Filtrar por conteúdo"
            options={[
              { value: "anexo", label: "Com anexo" },
              { value: "imagem", label: "Com imagem" },
            ]}
          />
          <SelectFilter
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            allLabel="Mais recentes"
            ariaLabel="Ordenar"
            options={[{ value: "antigas", label: "Mais antigas" }]}
          />
        </FilterBar>
      )}

      {notes.length === 0 && !creating ? (
        <EmptyState>
          Registre aqui resumos de reunião, planos de ação e observações sobre a
          empresa.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhuma anotação corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((n) => (
            <li
              key={n.id}
              className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
            >
              {editingId === n.id ? (
                <NoteEditor
                  userId={userId}
                  initialHTML={n.contentHtml}
                  initialVisible={n.visibleToClient}
                  initialAttachments={n.attachments.map(
                    ({ path, name, size, mime }) => ({ path, name, size, mime })
                  )}
                  saveLabel="Salvar alterações"
                  onSave={(html, vis, atts) => updateNote(n.id, html, vis, atts)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                      <Avatar
                        name={n.authorName}
                        url={n.authorAvatarUrl}
                        size={22}
                      />
                      {n.authorName}
                    </span>
                    <span className="text-fg-subtle">
                      em {formatDateTime(n.createdAtISO)}
                    </span>
                    {n.visibleToClient ? (
                      <span className="rounded-full bg-brand-tint px-2 py-0.5 font-medium text-risd">
                        Visível ao cliente
                      </span>
                    ) : (
                      <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-fg-muted">
                        Interna
                      </span>
                    )}
                    {canManage(n) && (
                      <span className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setCreating(false);
                            setEditingId(n.id);
                          }}
                          className="rounded-md px-2 py-1 font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(n)}
                          className="rounded-md px-2 py-1 font-medium text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-500/10"
                        >
                          Excluir
                        </button>
                      </span>
                    )}
                  </div>

                  <NoteBody
                    html={n.contentHtml}
                    onImageClick={(images, index) =>
                      setLightbox({ images, index })
                    }
                  />

                  {n.attachments.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {n.attachments.map((a) => (
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
                  )}

                  {n.updatedAtISO && (
                    <p className="mt-2 flex items-center gap-1 text-xs italic text-fg-subtle">
                      Editado por{" "}
                      {n.updatedByName && (
                        <Avatar
                          name={n.updatedByName}
                          url={n.updatedByAvatarUrl}
                          size={16}
                        />
                      )}
                      {n.updatedByName ?? "—"} em{" "}
                      {formatDateTime(n.updatedAtISO)}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && <ShowMore remaining={remaining} onClick={showMore} />}

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

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? deleteNote(deleting) : undefined)}
        title="Excluir anotação"
        description={
          deleting ? (
            <>
              A anotação de <strong>{deleting.authorName}</strong> de{" "}
              {formatDateTime(deleting.createdAtISO)} será removida
              permanentemente
              {deleting.attachments.length > 0
                ? `, junto com ${deleting.attachments.length} anexo${
                    deleting.attachments.length === 1 ? "" : "s"
                  }`
                : ""}
              .
            </>
          ) : undefined
        }
        confirmLabel="Excluir"
      />
    </section>
  );
}
