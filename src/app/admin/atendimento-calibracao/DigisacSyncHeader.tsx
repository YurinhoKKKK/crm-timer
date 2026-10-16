"use client";

import { useState } from "react";
import type { DigisacSyncStatus } from "@/lib/digisac-sync";

// Linha discreta de status do Digisac no cabeçalho da calibração: "Digisac
// sincronizado há 12 min" + ponto de status; clicar abre o detalhe. Em erro, a
// linha fica em destaque com o motivo. Substitui o antigo cartão grande.

function fmtAgo(iso: string | null): string {
  if (!iso) return "nunca sincronizado";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)} dias`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  parcial: "bg-amber-500",
  erro: "bg-red-500",
};

export default function DigisacSyncHeader({ status }: { status: DigisacSyncStatus }) {
  const [open, setOpen] = useState(false);
  const { lastRun, totalMessages, loadComplete, contactsWithCursor, totalContacts } = status;
  const st = lastRun?.status ?? null;
  const isError = st === "erro";
  const when = lastRun?.finished_at ?? lastRun?.started_at ?? null;

  if (isError) {
    return (
      <div className="mb-4 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        <div className="flex items-center gap-2 font-medium">
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
          Digisac: falha na sincronização ({fmtAgo(when)})
        </div>
        {lastRun?.error_message && (
          <p className="mt-1 text-xs">{lastRun.error_kind ?? "erro"}: {lastRun.error_message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        <span className={`h-2 w-2 rounded-full ${st ? DOT[st] ?? "bg-fg-subtle" : "bg-fg-subtle"}`} aria-hidden="true" />
        Digisac sincronizado {fmtAgo(when)}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <dl className="mt-2 grid max-w-xl grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 text-sm shadow-card sm:grid-cols-3">
          <div>
            <dt className="text-xs text-fg-subtle">Última execução</dt>
            <dd className="text-fg">{fmtDateTime(when)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Status</dt>
            <dd className="text-fg">{st === "ok" ? "OK" : st === "parcial" ? "Parcial (continua)" : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Mensagens no banco</dt>
            <dd className="tabular-nums text-fg">{totalMessages.toLocaleString("pt-BR")}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Gravadas (última)</dt>
            <dd className="tabular-nums text-fg">{lastRun?.messages_upserted ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Carga do histórico</dt>
            <dd className="text-fg">
              {loadComplete ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">concluída</span>
              ) : (
                <>em andamento <span className="tabular-nums text-fg-muted">({contactsWithCursor}/{totalContacts})</span></>
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
