"use client";

import { useState, useTransition } from "react";
import type { ListingValidationState } from "@/lib/client-portal";
import { clientPortalValidateListing } from "@/app/cliente/actions";
import { formatPortalDate } from "./portal-format";

// Validação de uma listagem pelo cliente (passo 33). OPCIONAL e SILENCIOSA:
// nenhum contador de pendência, nenhuma cobrança de quem não avaliou. Um clique
// para aprovar; comentário só onde é obrigatório (ajuste/contestação). Registrar
// é append-only — mudar de ideia é um novo evento; o estado mostrado é o último.
//
// Em modo pré-visualização ("Ver como cliente"), `token` é null: mostra só o
// estado, sem ações (a equipe não age como cliente).

type Kind = "listed" | "not_listed";

const STATE_LABEL: Record<ListingValidationState["event"], string> = {
  aprovado: "Aprovada",
  ajuste_solicitado: "Ajuste solicitado",
  contestado: "Contestação enviada",
};

export default function PortalListingActions({
  token,
  listingResultId,
  kind,
  initial,
}: {
  token: string | null;
  listingResultId: string;
  kind: Kind;
  initial: ListingValidationState | null;
}) {
  const [state, setState] = useState<ListingValidationState | null>(initial);
  const [openComment, setOpenComment] = useState<
    "ajuste_solicitado" | "contestado" | null
  >(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const readOnly = !token;

  function submit(event: ListingValidationState["event"], text: string) {
    if (!token) return;
    setError(null);
    const previous = state;
    // Otimista: mostra o novo estado na hora.
    setState({ event, comment: text || null, by: "cliente", at: new Date().toISOString() });
    setOpenComment(null);
    setComment("");
    startTransition(async () => {
      const res = await clientPortalValidateListing(
        token,
        listingResultId,
        event,
        text
      );
      if (res.error) {
        setState(previous); // reverte
        setError(res.error);
      }
    });
  }

  // Estado atual (discreto), com o comentário quando houver.
  const stateLine = state && (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
          state.event === "aprovado"
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        }`}
      >
        {state.event === "aprovado" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
        {STATE_LABEL[state.event]}
        {state.by === "cliente" ? " por você" : ""}
        {` em ${formatPortalDate(state.at)}`}
      </span>
      {state.comment && (
        <span className="text-fg-muted">“{state.comment}”</span>
      )}
    </div>
  );

  if (readOnly) {
    return stateLine || null;
  }

  return (
    <div className="mt-2.5">
      {stateLine}

      {openComment ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = comment.trim();
            if (!text) {
              setError("Escreva um comentário para a equipe.");
              return;
            }
            submit(openComment, text);
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            placeholder={
              openComment === "contestado"
                ? "Por que essa marca é importante para você?"
                : "O que gostaria de ajustar nesta listagem?"
            }
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-risd focus:outline-none focus:ring-2 focus:ring-risd/30"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-risd px-3 py-1.5 text-sm font-medium text-white transition hover:bg-chrysler disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Enviar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenComment(null);
                setComment("");
                setError(null);
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {kind === "listed" ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => submit("aprovado", "")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-500/10 disabled:opacity-60 dark:text-emerald-400"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
                Aprovar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpenComment("ajuste_solicitado");
                  setError(null);
                }}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg disabled:opacity-60"
              >
                Solicitar ajuste
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpenComment("contestado");
                setError(null);
              }}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg disabled:opacity-60"
            >
              Gostaria de listar esta marca
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
