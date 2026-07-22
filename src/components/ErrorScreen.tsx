"use client";

import Link from "next/link";
import { btnPrimary, btnSecondary } from "@/lib/ui";

// Tela de erro dos boundaries das ÁREAS AUTENTICADAS (admin/consultor/
// colaborador e o fallback da raiz). É ESTÁTICA e NEUTRA por decisão de
// segurança: não busca dado nenhum (não pode virar caminho para dado de outra
// empresa ao falhar) e NÃO mostra stack, digest nem mensagem técnica do erro —
// só um texto amigável e as ações. O erro real é registrado no console/log,
// nunca na tela (ver o error.tsx que renderiza isto).
export default function ErrorScreen({
  reset,
  home,
}: {
  reset: () => void;
  // Volta para uma tela segura da própria área. Ausente no fallback da raiz,
  // que fica neutro (só "tentar de novo") para nunca rotear ninguém — inclusive
  // um cliente — para dentro de uma área que não é a dele.
  home?: { href: string; label: string };
}) {
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
          Tivemos um problema ao montar esta página. Você pode tentar de novo —
          se continuar, volte ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className={btnPrimary}>
            Tentar de novo
          </button>
          {home && (
            <Link href={home.href} className={btnSecondary}>
              {home.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
