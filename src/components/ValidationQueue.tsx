"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import MarketplaceBadge from "@/components/MarketplaceBadge";
import { createClient } from "@/lib/supabase-browser";
import { emitValidationsRead } from "@/lib/message-sync";
import {
  fetchValidationQueue,
  markValidationsRead,
  type ValidationQueueRow,
} from "@/app/validation-actions";
import type { ListingMarketplace } from "@/lib/types";

// "Onde ver" (passo 33): listagens com AJUSTE SOLICITADO ou CONTESTAÇÃO em
// aberto, sem caçar empresa por empresa. Vive na caixa de entrada (a mesma
// superfície das mensagens), coerente com o badge de fonte única.
//
// Escopo por cargo é do BANCO (listing_validation_queue é SECURITY INVOKER —
// herda a RLS lv_select): admin todas; consultor as dele; COLABORADOR só as
// listagens que são responsabilidade dele. Componente VIVO: ressincroniza ao
// montar, no Realtime de listing_validations e ao voltar o foco. Ao montar,
// marca as validações como vistas (zera a parte do badge); a fila continua.

const EVENT_LABEL: Record<ValidationQueueRow["eventType"], string> = {
  ajuste_solicitado: "Ajuste solicitado",
  contestado: "Gostaria de listar",
};

function hrefFor(
  role: "admin" | "consultor" | "colaborador",
  companyId: string
): string {
  if (role === "admin") return `/admin/empresas/${companyId}?aba=listings`;
  if (role === "consultor") return `/consultor/${companyId}?aba=listings`;
  return `/colaborador/${companyId}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString("pt-BR", {
    day: sameDay ? undefined : "2-digit",
    month: sameDay ? undefined : "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ValidationQueue({
  role,
  initial,
}: {
  role: "admin" | "consultor" | "colaborador";
  initial: ValidationQueueRow[];
}) {
  const [rows, setRows] = useState<ValidationQueueRow[]>(initial);
  const debounceRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const next = await fetchValidationQueue();
    setRows(next);
  }, []);

  useEffect(() => {
    // Visto → zera a parte de validações do badge (a fila permanece).
    markValidationsRead().then(() => emitValidationsRead());

    const supabase = createClient();
    const channel = supabase
      .channel("validation-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "listing_validations" },
        () => {
          window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(refresh, 300);
        }
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [refresh]);

  if (rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl border border-amber-300/60 bg-amber-50/50 p-4 shadow-card dark:border-amber-500/30 dark:bg-amber-500/5 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-fg">
          Listagens para revisar
        </h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {rows.length}
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.listingResultId}>
            <Link
              href={hrefFor(role, r.companyId)}
              className="block rounded-xl border border-line bg-surface p-3 transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-fg">{r.companyName}</span>
                <span className="text-fg-subtle">·</span>
                <span className="text-sm text-fg-muted">{r.brand}</span>
                <MarketplaceBadge
                  marketplace={r.marketplace as ListingMarketplace}
                />
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.eventType === "contestado"
                      ? "bg-risd/10 text-risd dark:text-white"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {EVENT_LABEL[r.eventType]}
                </span>
                <span className="ml-auto text-xs text-fg-subtle">
                  {formatWhen(r.at)}
                </span>
              </div>
              {r.comment && (
                <p className="mt-1.5 text-sm text-fg-muted">“{r.comment}”</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
