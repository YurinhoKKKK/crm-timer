"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { CompanyNoteView, NoteAttachmentMeta } from "@/lib/notes";
import { createClient } from "@/lib/supabase-browser";
import { formatBytes } from "@/lib/format";
import ConfirmDialog from "@/components/ConfirmDialog";
import Lightbox from "@/components/Lightbox";
import Avatar from "@/components/Avatar";
import NoteBody from "./NoteBody";
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
            ? "Nenhuma atualização ainda."
            : filtered.length === notes.length
              ? `${notes.length} atualizaç${notes.length === 1 ? "ão" : "ões"}`
              : `${filtered.length} de ${notes.length} atualizações`}
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
            Nova atualização
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
            placeholder="Buscar nas atualizações…"
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
        <EmptyState>Nenhuma atualização corresponde aos filtros.</EmptyState>
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
        title="Excluir atualização"
        description={
          deleting ? (
            <>
              A atualização de <strong>{deleting.authorName}</strong> de{" "}
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
