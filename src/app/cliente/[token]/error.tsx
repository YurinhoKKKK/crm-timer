"use client";

import { useEffect } from "react";
import { btnPrimary, btnSecondary } from "@/lib/ui";

// Boundary de erro do PORTAL DO CLIENTE. Diferente do das áreas internas em
// dois pontos que importam:
//   1. NENHUM caminho para telas internas — só recuperar aqui mesmo. "Tentar
//      de novo" (reset) e "Recarregar" (a URL tem o token, então recarregar
//      permanece em /cliente/<token>); nada leva o cliente para fora do portal.
//   2. Vale DOBRADO a regra de não vazar nada técnico: a tela é estática e
//      neutra; o erro real vai só para o console/log, jamais para a tela.
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal] erro ao renderizar a tela:", error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 text-fg">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold text-fg">
          Algo deu errado ao carregar esta tela
        </h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Tivemos um problema ao carregar seu portal. Tente de novo em instantes.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className={btnPrimary}>
            Tentar de novo
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={btnSecondary}
          >
            Recarregar a página
          </button>
        </div>
      </div>
    </div>
  );
}
