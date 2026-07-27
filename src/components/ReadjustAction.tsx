"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markListingReadjusted } from "@/app/listing-actions";

// Botão "Marcar como reajustada" (lado interno) — aparece só nas listagens com
// ajuste/contestação PENDENTE do cliente. Comentário OPCIONAL (o que foi feito).
// Ao confirmar, a listagem passa a AGUARDAR RECONFIRMAÇÃO do cliente. Recarrega
// os dados do servidor (router.refresh) para o estado/linha do tempo refletirem.
export default function ReadjustAction({
  listingResultId,
}: {
  listingResultId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await markListingReadjusted(listingResultId, comment);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setComment("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface dark:text-sky-300"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          Marcar como reajustada
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        autoFocus
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        placeholder="O que foi ajustado? (opcional — ex.: troquei a foto principal)"
        className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-risd focus:outline-none focus:ring-2 focus:ring-risd/30"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-risd px-3 py-1.5 text-sm font-medium text-white transition hover:bg-chrysler disabled:opacity-60"
        >
          {pending ? "Marcando…" : "Confirmar reajuste"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setComment("");
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg"
        >
          Cancelar
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
