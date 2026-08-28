"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Eye, Lock, PencilLine, X } from "lucide-react";
import type { CompanyNoteView, NoteAttachmentMeta } from "@/lib/notes";
import { createClient } from "@/lib/supabase-browser";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import Lightbox from "@/components/Lightbox";
import NoteBody from "@/components/company-central/NoteBody";
import { getPanelNotes } from "./notes-panel-actions";

// O editor (TipTap) só entra no bundle quando o painel de fato abre e este
// módulo é avaliado — e ainda assim carregado sob demanda, para não pesar nem a
// primeira pintura do painel. Nada disso toca a lista de empresas / o painel do
// consultor (o próprio NotesPanel já é importado via next/dynamic pelo balão).
const NoteEditor = dynamic(
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

// Painel lateral de atalho para as anotações de uma empresa (mesmo espírito do
// balão de atualizações do Monday): ler as últimas e escrever uma nova sem sair
// da lista. Reusa o MESMO editor rich text da aba de Anotações (upload de
// imagem/arquivo inclusos) e a MESMA barreira de permissão (RLS cn_*).
//
// Segurança do visible_to_client: toda anotação nasce interna (o NoteEditor já
// começa com o toggle desmarcado); tornar visível ao cliente exige confirmação
// explícita antes de gravar. Ninguém apaga anotação por aqui.
export default function NotesPanel({
  companyId,
  companyName,
  userId,
  isAdmin,
  notesHref,
  onClose,
  onCountChange,
}: {
  companyId: string;
  companyName: string;
  userId: string;
  isAdmin: boolean;
  // Rota da aba completa de Anotações da empresa (admin ou consultor).
  notesHref: string;
  onClose: () => void;
  // Avisa o balão para atualizar a contagem sem recarregar a tela (delta).
  onCountChange: (delta: number) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<CompanyNoteView[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [navPending, startNav] = useTransition();
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);

  // Gate de confirmação de "visível ao cliente": o save do editor espera esta
  // promessa; confirmar resolve true, cancelar/fechar resolve false.
  const [confirmVisible, setConfirmVisible] = useState(false);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  function askVisibleConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      confirmResolver.current = resolve;
      setConfirmVisible(true);
    });
  }
  function resolveConfirm(ok: boolean) {
    const r = confirmResolver.current;
    confirmResolver.current = null;
    setConfirmVisible(false);
    r?.(ok);
  }

  const reload = useCallback(async () => {
    const res = await getPanelNotes(companyId);
    if (res.error) {
      setError(res.error);
    } else {
      setError(null);
      setNotes(res.notes ?? []);
    }
  }, [companyId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPanelNotes(companyId).then((res) => {
      if (!active) return;
      if (res.error) setError(res.error);
      else setNotes(res.notes ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  // Fechar por Esc (clique fora é o backdrop). Não fecha enquanto o diálogo de
  // confirmação está aberto — lá o Esc pertence ao diálogo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmResolver.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ação DENTRO de painel = button com router.push em useTransition, nunca <a>
  // (regra do passo 32.2).
  function openFullTab() {
    startNav(() => router.push(notesHref));
  }

  // Grava (cria ou edita) via supabase-browser sob a RLS — o author_id é sempre
  // o próprio usuário (o banco reforça author_id = auth.uid()). Se for salvar
  // como visível ao cliente, confirma antes.
  async function persist(
    id: string | null,
    html: string,
    visibleToClient: boolean,
    attachments: NoteAttachmentMeta[]
  ): Promise<{ error?: string | null }> {
    if (visibleToClient) {
      const ok = await askVisibleConfirm();
      // Cancelou a publicação: mantém o editor aberto, sem gravar.
      if (!ok) return { error: null };
    }
    const supabase = createClient();
    if (id) {
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
      await reload();
      return { error: null };
    }
    const { error } = await supabase.from("company_notes").insert({
      company_id: companyId,
      author_id: userId,
      content_html: html,
      visible_to_client: visibleToClient,
      attachments,
    });
    if (error) return { error: error.message };
    setCreating(false);
    onCountChange(1); // atualiza o balão sem recarregar a tela
    await reload();
    return { error: null };
  }

  const canManage = (n: CompanyNoteView) => isAdmin || n.authorId === userId;

  return createPortal(
    // z-overlay (50): escala de camadas do passo 32.2 (tailwind.config.ts).
    <div className="fixed inset-0 z-overlay flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Anotações de ${companyName}`}
        // Largura ~48% em telas grandes (referência: painel de atualizações do
        // Monday), com teto para não esticar em ultrawide; tela cheia no estreito.
        className="relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-pop sm:w-[48%] sm:max-w-[860px]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              Anotações
            </p>
            <h2 className="truncate text-lg font-semibold text-fg">
              {companyName}
            </h2>
            <button
              type="button"
              onClick={openFullTab}
              disabled={navPending}
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60"
            >
              {navPending ? "Abrindo…" : "Abrir aba completa de Anotações →"}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Escrever uma nova anotação (o objetivo do atalho). */}
          {creating ? (
            <div className="mb-4">
              <NoteEditor
                userId={userId}
                toolbarOffset="0px"
                onSave={(html, vis, atts) => persist(null, html, vis, atts)}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setCreating(true);
              }}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              <PencilLine size={16} />
              Escrever anotação
            </button>
          )}

          {loading ? (
            <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">
                Não foi possível carregar as anotações.
              </p>
              <p className="mt-1 text-xs text-fg-subtle">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  reload().finally(() => setLoading(false));
                }}
                className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
              >
                Tentar de novo
              </button>
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-2/30 p-6 text-center text-sm text-fg-subtle">
              Nenhuma anotação ainda. Escreva a primeira — resumos de reunião,
              planos de ação e observações sobre o cliente.
            </div>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-xl border border-line bg-surface p-4 shadow-card"
                >
                  {editingId === n.id ? (
                    <NoteEditor
                      userId={userId}
                      toolbarOffset="0px"
                      initialHTML={n.contentHtml}
                      initialVisible={n.visibleToClient}
                      initialAttachments={n.attachments.map(
                        ({ path, name, size, mime }) => ({
                          path,
                          name,
                          size,
                          mime,
                        })
                      )}
                      saveLabel="Salvar alterações"
                      onSave={(html, vis, atts) =>
                        persist(n.id, html, vis, atts)
                      }
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
                        {/* Marcação INEQUÍVOCA, com texto e não só cor: uma
                            anotação visível ao cliente aparece no portal. */}
                        {n.visibleToClient ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                            <Eye size={12} />
                            Visível ao cliente
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-fg-muted">
                            <Lock size={12} />
                            Interna
                          </span>
                        )}
                        {canManage(n) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCreating(false);
                              setEditingId(n.id);
                            }}
                            className="ml-auto rounded-md px-2 py-1 font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                          >
                            Editar
                          </button>
                        )}
                      </div>

                      {/* Recolhe anotações longas por ALTURA, com degradê e "Ler
                          mais"/"Ler menos"; clicar numa imagem abre o lightbox.
                          Mesmo componente da aba (só muda o rótulo do botão). */}
                      <NoteBody
                        html={n.contentHtml}
                        className="rich-text note-view text-sm"
                        moreLabel="Ler mais"
                        lessLabel="Ler menos"
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
                                className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                              >
                                <span className="min-w-0 truncate">{a.name}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}

                      {n.updatedAtISO && (
                        <p className="mt-2 flex items-center gap-1 text-xs italic text-fg-subtle">
                          Editado por {n.updatedByName ?? "—"} em{" "}
                          {formatDateTime(n.updatedAtISO)}
                        </p>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Confirmação explícita antes de publicar ao cliente (o risco de errar é
          maior num atalho de escrita rápida). */}
      <ConfirmDialog
        open={confirmVisible}
        tone="primary"
        title="Tornar esta anotação visível ao cliente?"
        description={
          <>
            Ela aparecerá no <strong>portal do cliente</strong> de{" "}
            <strong>{companyName}</strong>. Anotações internas são o padrão —
            confirme apenas se o cliente deve mesmo ler este conteúdo.
          </>
        }
        confirmLabel="Sim, publicar ao cliente"
        cancelLabel="Manter interna"
        onClose={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />

      {/* z-lightbox (100) fica ACIMA do painel (z-overlay 50); o Esc do Lightbox
          usa captura + stopImmediatePropagation, então fecha só a imagem. */}
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
    </div>,
    document.body
  );
}
