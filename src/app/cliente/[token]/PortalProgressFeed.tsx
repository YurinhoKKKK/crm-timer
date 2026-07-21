"use client";

import { useState } from "react";
import { ShowMore } from "@/components/ListControls";
import type {
  PortalProgress,
  PortalProgressItem,
  PortalSource,
} from "@/lib/client-portal";
import { clientPortalProgressPage } from "../actions";
import { clientPreviewProgressPage } from "@/app/client-preview-actions";

// Aba "Andamento" do portal do cliente (passo 25.1). Timeline curada: itens
// "Em andamento" no topo (marcador neutro, sem data/prazo) e depois os
// "Entregues" (check + SÓ a data de conclusão). O conjunto já chega curado
// do banco (client_portal_progress seleciona apenas título/estado/data);
// aqui não existe consulta — o "ver mais" pede a PRÓXIMA PÁGINA ao servidor
// (paginação no servidor: nunca carrega tudo de uma vez).
//
// A origem da página seguinte muda conforme o caminho (sessão do cliente ou
// pré-visualização interna), mas o conteúdo é o mesmo: as duas ações caem na
// mesma curadoria no banco.

export default function PortalProgressFeed({
  source,
  initial,
}: {
  source: PortalSource;
  initial: PortalProgress;
}) {
  const [items, setItems] = useState<PortalProgressItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, total - items.length);

  async function showMore() {
    if (loading) return;
    setLoading(true);
    setError(null);
    const page =
      source.mode === "portal"
        ? await clientPortalProgressPage(source.token, items.length)
        : await clientPreviewProgressPage(source.companyId, items.length);
    if (!page) {
      setError(
        "Não foi possível carregar mais itens. Recarregue a página e tente de novo."
      );
    } else {
      setItems((prev) => [...prev, ...page.items]);
      setTotal(page.total);
    }
    setLoading(false);
  }

  const inProgress = items.filter((i) => i.state === "em_andamento");
  const delivered = items.filter((i) => i.state === "entregue");

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-tint text-risd">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            <circle cx="12" cy="12" r="6" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Andamento do projeto
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            O que a equipe está fazendo agora e o que já foi entregue.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-7">
        {inProgress.length > 0 && (
          <TimelineGroup title="Em andamento">
            {inProgress.map((item, i) => (
              <TimelineItem key={`p-${i}`} dot="progress">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="min-w-0 font-medium text-fg">{item.title}</p>
                  <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-muted">
                    Em andamento
                  </span>
                </div>
              </TimelineItem>
            ))}
          </TimelineGroup>
        )}

        {delivered.length > 0 && (
          <TimelineGroup title="Entregues">
            {delivered.map((item, i) => (
              <TimelineItem key={`d-${i}`} dot="done">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="min-w-0 font-medium text-fg">{item.title}</p>
                  {item.done_on && (
                    <span className="text-xs text-fg-subtle">
                      Entregue em {formatDay(item.done_on)}
                    </span>
                  )}
                </div>
              </TimelineItem>
            ))}
          </TimelineGroup>
        )}
      </div>

      {remaining > 0 && !loading && (
        <ShowMore remaining={remaining} onClick={showMore} />
      )}
      {loading && (
        <p className="mt-4 text-center text-sm text-fg-subtle">Carregando…</p>
      )}
      {error && (
        <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function TimelineGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </p>
      <ol className="space-y-0">{children}</ol>
    </div>
  );
}

// Item da timeline: linha vertical contínua à esquerda com o marcador do
// estado (neutro pulsante para "em andamento"; check verde para entregue).
function TimelineItem({
  dot,
  children,
}: {
  dot: "progress" | "done";
  children: React.ReactNode;
}) {
  return (
    <li className="relative pb-4 pl-8 last:pb-0">
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-[9px] top-6 w-px bg-line [li:last-child>&]:hidden"
      />
      {dot === "progress" ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1 grid h-5 w-5 place-items-center rounded-full border border-risd/40 bg-brand-tint"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-risd" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
      )}
      {children}
    </li>
  );
}

// done_on chega como data pura (YYYY-MM-DD, já em Brasília, calculada no
// SQL). Formata sem passar por Date para não sofrer deslocamento de fuso.
function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}
