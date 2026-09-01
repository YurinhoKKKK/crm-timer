"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MarketplaceBadge from "@/components/MarketplaceBadge";
import { SelectFilter } from "@/components/ListControls";
import { createClient } from "@/lib/supabase-browser";
import { emitValidationsRead } from "@/lib/message-sync";
import {
  fetchValidationQueue,
  markValidationsRead,
  type ValidationQueueRow,
} from "@/app/validation-actions";
import type { ListingMarketplace } from "@/lib/types";

// "Listagens para revisar" (passo 33): listagens com AJUSTE SOLICITADO ou
// CONTESTAÇÃO em aberto. Vive na caixa de entrada, mas em SEÇÃO PRÓPRIA e
// RETRÁTIL — separada das conversas —, para o colaborador não confundir o que é
// mensagem com o que é trabalho de listagem. Nasce EXPANDIDA quando há pendência
// (e o contador fica sempre visível no título, mesmo recolhida).
//
// Escopo por cargo é do BANCO (listing_validation_queue é SECURITY INVOKER —
// herda a RLS lv_select): admin todas; consultor as dele; COLABORADOR só as
// listagens que são responsabilidade dele. Os filtros abaixo agem só em memória
// sobre esse conjunto já escopado. Componente VIVO: ressincroniza no Realtime de
// listing_validations e ao voltar o foco. Ao montar, marca as validações como
// vistas (zera a parte do badge); a fila continua.

const EVENT_LABEL: Record<ValidationQueueRow["eventType"], string> = {
  ajuste_solicitado: "Ajuste solicitado",
  contestado: "Gostaria de listar",
};

const TYPE_OPTIONS = [
  { value: "ajuste_solicitado", label: "Ajuste solicitado" },
  { value: "contestado", label: "Gostaria de listar" },
];

function hrefFor(
  role: "admin" | "consultor" | "colaborador",
  row: ValidationQueueRow
): string {
  if (role === "admin")
    return `/admin/empresas/${row.companyId}?aba=listings`;
  if (role === "consultor")
    return `/consultor/${row.companyId}?aba=listings`;
  // Colaborador: leva DIRETO à sua tela "Minhas Listagens" com a listagem
  // específica destacada (rolagem + realce), em vez de uma lista genérica.
  return `/colaborador/listagens?destaque=${row.listingResultId}`;
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
  standalone = false,
}: {
  role: "admin" | "consultor" | "colaborador";
  initial: ValidationQueueRow[];
  // Na tela própria "Validações" a fila é o conteúdo único da página: quando
  // vazia, mostra um estado vazio amigável em vez de sumir (null). Dentro da
  // antiga caixa de entrada segue null — lá era só uma seção entre outras.
  standalone?: boolean;
}) {
  const [rows, setRows] = useState<ValidationQueueRow[]>(initial);
  // Nasce expandida quando já há trabalho a revisar.
  const [open, setOpen] = useState(initial.length > 0);
  const [company, setCompany] = useState("");
  const [type, setType] = useState("");
  const [asc, setAsc] = useState(true); // mais antigo primeiro (o que espera há mais tempo)
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

  // Empresas presentes na fila (para o filtro), já dentro do escopo do cargo.
  const companies = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows) byId.set(r.companyId, r.companyName);
    return Array.from(byId, ([value, label]) => ({ value, label })).sort(
      (a, b) => a.label.localeCompare(b.label, "pt-BR")
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const out = rows.filter(
      (r) =>
        (!company || r.companyId === company) &&
        (!type || r.eventType === type)
    );
    out.sort((a, b) => {
      const cmp = a.at.localeCompare(b.at);
      return asc ? cmp : -cmp;
    });
    return out;
  }, [rows, company, type, asc]);

  if (rows.length === 0) {
    if (!standalone) return null;
    return (
      <section className="rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
        <p className="text-sm font-medium text-fg">Nenhuma listagem a revisar</p>
        <p className="mt-1 text-sm text-fg-muted">
          Quando um cliente pedir ajuste ou quiser listar um item, ele aparece
          aqui.
        </p>
      </section>
    );
  }

  const showFilters = rows.length > 1;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-amber-300/60 bg-amber-50/50 shadow-card dark:border-amber-500/30 dark:bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="validation-queue-body"
        className="flex w-full items-center gap-2 p-4 text-left transition hover:bg-amber-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-risd sm:p-5"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`text-amber-600 transition-transform dark:text-amber-400 ${
            open ? "rotate-90" : ""
          }`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <h2 className="text-sm font-semibold text-fg">Listagens para revisar</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
          {rows.length}
        </span>
        <span className="ml-auto text-xs font-medium text-fg-subtle">
          {open ? "Recolher" : "Expandir"}
        </span>
      </button>

      {open && (
        <div id="validation-queue-body" className="px-4 pb-4 sm:px-5 sm:pb-5">
          {showFilters && (
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <SelectFilter
                value={company}
                onChange={setCompany}
                allLabel="Todas as empresas"
                ariaLabel="Filtrar por empresa"
                options={companies}
              />
              <SelectFilter
                value={type}
                onChange={setType}
                allLabel="Todos os tipos"
                ariaLabel="Filtrar por tipo"
                options={TYPE_OPTIONS}
              />
              <button
                type="button"
                onClick={() => setAsc((v) => !v)}
                aria-pressed={!asc}
                title={asc ? "Mais antigo primeiro" : "Mais recente primeiro"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={asc ? "" : "rotate-180"}
                >
                  <path d="M12 5v14M6 11l6-6 6 6" />
                </svg>
                {asc ? "Mais antigas" : "Mais recentes"}
              </button>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface/60 px-4 py-6 text-center text-sm text-fg-muted">
              Nenhuma listagem corresponde aos filtros.
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((r) => (
                <li key={r.listingResultId}>
                  <Link
                    href={hrefFor(role, r)}
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
          )}
        </div>
      )}
    </section>
  );
}
