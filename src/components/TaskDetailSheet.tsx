"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { STATUS_META, isOverdue } from "@/lib/status";
import { formatDuration, formatDue } from "@/lib/format";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import Person from "@/components/Person";
import LabelChips from "@/components/LabelChips";
import CreatorMeta from "@/components/CreatorMeta";
import ListingResultsView from "@/components/ListingResultsView";
import { marketplaceLabel } from "@/lib/listing";
import {
  getTaskDetail,
  setTaskClientHidden,
  type TaskDetail,
} from "@/app/task-detail-actions";

// Painel de detalhe da TAREFA — o destino unificado de qualquer clique em
// tarefa no sistema. Modo LEITURA por padrão: mostra tudo (empresa,
// responsável, prazo, tipo, descrição/instruções, criador, tempo + ajustes,
// resumo da finalização + WhatsApp e as entregas de listagem). A edição fica
// no rodapé, apontando para o formulário que já existe para o cargo (as ações
// vêm calculadas do servidor; tarefas feitas abrem sem edição). Painel lateral
// (e não rota) para não perder o contexto da lista: filtros e rolagem ficam
// intactos ao fechar.
export default function TaskDetailSheet({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getTaskDetail(taskId).then((res) => {
      if (!active) return;
      if (res.error) setError(res.error);
      else setDetail(res.detail ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [taskId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const meta = detail ? STATUS_META[detail.status] : null;
  const overdue = detail ? isOverdue(detail.status, detail.due_at) : false;

  // Portal no body (mesma razão do BreakdownPanel). z-sheet (60): por cima de
  // outros painéis/modais (z-overlay, 50) e do pill do timer (z-pill, 45).
  // Escala de camadas em tailwind.config.ts.
  return createPortal(
    <div className="fixed inset-0 z-sheet flex justify-end">
      <div
        className="absolute inset-0 bg-gunmetal/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={detail ? `Detalhe da tarefa — ${detail.title}` : "Detalhe da tarefa"}
        className="relative flex h-full w-full max-w-lg flex-col overflow-hidden bg-surface shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              Detalhe da tarefa
            </p>
            {detail ? (
              <>
                <h2 className="mt-0.5 text-lg font-semibold leading-snug text-fg">
                  {detail.title}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {meta && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  )}
                  {overdue && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
                      Atrasada
                    </span>
                  )}
                  {detail.kindLabel && (
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                      {detail.kindLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm text-fg-muted">
                  {detail.companyName}
                </p>
              </>
            ) : (
              <h2 className="mt-0.5 text-lg font-semibold text-fg">…</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : detail ? (
            <div className="space-y-5 text-sm">
              {detail.labels.length > 0 && <LabelChips labels={detail.labels} size="md" />}

              {/* Dados principais */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-xs text-fg-subtle">Responsável</dt>
                  <dd className="mt-0.5 text-fg">
                    <Person
                      name={detail.collaboratorName}
                      avatarUrl={detail.collaboratorAvatarUrl}
                      size={20}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Prazo</dt>
                  <dd className={`mt-0.5 ${overdue ? "font-medium text-red-600 dark:text-red-400" : "text-fg"}`}>
                    {formatDue(detail.due_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Data da ocorrência</dt>
                  <dd className="mt-0.5 text-fg">{formatTaskDate(detail.task_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Tempo gasto (total)</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-fg">
                    {formatDuration(detail.totalSeconds)}
                  </dd>
                </div>
              </dl>

              {/* Ajustes manuais de tempo (auditoria) */}
              {detail.adjustments.length > 0 && (
                <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Tempo ajustado manualmente
                  </p>
                  <ul className="mt-2 space-y-2">
                    {detail.adjustments.map((a, i) => (
                      <li key={i} className="text-xs text-amber-800 dark:text-amber-200/90">
                        <span className="font-mono tabular-nums">
                          {formatDuration(a.oldSeconds)} → {formatDuration(a.newSeconds)}
                        </span>{" "}
                        · por{" "}
                        <Person name={a.by} avatarUrl={a.byAvatarUrl} size={16} />{" "}
                        em {formatDateTime(a.at)}
                        {a.reason && (
                          <span className="italic"> · “{a.reason}”</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Descrição e instruções */}
              {detail.description && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Descrição
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-fg-muted">
                    {detail.description}
                  </p>
                </div>
              )}
              {detail.instructions && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Instruções
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-fg-muted">
                    {detail.instructions}
                  </p>
                </div>
              )}

              {/* O que foi feito (só em finalizada) */}
              {detail.status === "finalizada" && (
                <div className="rounded-lg border border-emerald-300/50 bg-emerald-50/60 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      Resumo da finalização
                    </p>
                    {detail.noteSentWhatsapp ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        Enviado ao WhatsApp
                      </span>
                    ) : (
                      <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg-subtle">
                        Não enviado ao WhatsApp
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-fg">
                    {detail.completionNote?.trim() || "(sem resumo registrado)"}
                  </p>
                  {detail.finished_at && (
                    <p className="mt-1.5 text-xs text-fg-subtle">
                      Finalizada em {formatDateTime(detail.finished_at)}
                    </p>
                  )}
                </div>
              )}

              {/* Listagem de marcas: o que foi pedido + o que foi entregue */}
              {detail.listing && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Listagem de marcas
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.listing.brands.map((b) => (
                      <span
                        key={b.id}
                        className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-fg"
                      >
                        {b.name}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    Marketplaces:{" "}
                    {detail.listing.marketplaces.map(marketplaceLabel).join(", ") ||
                      "nenhum"}
                    {" · "}Margem:{" "}
                    {detail.listing.needsMargin
                      ? `sim${detail.listing.taxRate !== null ? ` (alíquota ${detail.listing.taxRate}%)` : ""}`
                      : "não"}
                  </p>
                  <ListingResultsView
                    results={detail.listingResults}
                    className="mt-3"
                  />
                </div>
              )}

              {/* Portal do cliente (passo 25.1): opt-out do feed Andamento.
                  Só aparece em tarefa elegível ao feed e para admin/consultor
                  (calculado no servidor); colaborador nunca vê. */}
              {detail.canToggleClientHidden && (
                <ClientVisibilityToggle
                  taskId={detail.id}
                  hidden={detail.clientHidden}
                  onChange={(hidden) =>
                    setDetail((d) => (d ? { ...d, clientHidden: hidden } : d))
                  }
                />
              )}

              {/* Transparência de criação */}
              <div className="border-t border-line pt-3">
                <CreatorMeta
                  label="Criada por"
                  who={detail.creator.who}
                  whoAvatarUrl={detail.creator.whoAvatarUrl}
                  whenISO={detail.creator.whenISO}
                  fromStandard={detail.creator.fromStandard}
                  systemGenerated={detail.creator.systemGenerated}
                  hasOrigin={detail.creator.hasOrigin}
                />
              </div>
            </div>
          ) : null}
        </div>

        {detail && detail.actions.length > 0 && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-line p-4">
            {detail.actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={a.primary ? btnPrimary : btnSecondary}
              >
                {a.label}
              </Link>
            ))}
          </footer>
        )}
      </aside>
    </div>,
    document.body
  );
}

// Toggle "Ocultar do cliente / Mostrar ao cliente" (passo 25.1). Grava
// task_instances.client_hidden via server action; a autorização real está no
// banco (RLS + gatilho guard_client_hidden).
function ClientVisibilityToggle({
  taskId,
  hidden,
  onChange,
}: {
  taskId: string;
  hidden: boolean;
  onChange: (hidden: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await setTaskClientHidden(taskId, !hidden);
    if (res.error) setError(res.error);
    else onChange(!hidden);
    setPending(false);
  }

  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-fg">Portal do cliente</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {hidden
              ? "Oculta do cliente — não aparece no Andamento do portal."
              : "Visível no Andamento do portal (quando iniciada ou finalizada)."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
        >
          {pending
            ? "Salvando…"
            : hidden
              ? "Mostrar ao cliente"
              : "Ocultar do cliente"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function formatTaskDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Instantes (finalização/ajustes) sempre no fuso de Brasília, como o resto do
// sistema (evita divergência SSR × navegador).
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
