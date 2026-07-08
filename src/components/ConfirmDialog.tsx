"use client";

import { useState } from "react";
import Modal from "./Modal";
import { btnSecondary } from "@/lib/ui";

// Modal de confirmação padrão do sistema (substitui window.confirm). Cuida do
// estado de "processando" e mostra erro sem fechar. `onConfirm` pode devolver
// { error } para exibir a mensagem e manter o modal aberto.
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<{ error?: string | null } | void> | void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await onConfirm();
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (busy) return;
    setError(null);
    onClose();
  }

  const confirmClass =
    tone === "danger"
      ? "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
      : "rounded-lg bg-risd px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <Modal open={open} onClose={handleClose} labelledBy="confirm-dialog-title">
      <div className="flex items-start gap-3">
        {tone === "danger" && (
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300"
            aria-hidden="true"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2
            id="confirm-dialog-title"
            className="text-base font-semibold text-fg"
          >
            {title}
          </h2>
          {description && (
            <div className="mt-1.5 text-sm text-fg-muted">{description}</div>
          )}
          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleClose}
          disabled={busy}
          className={btnSecondary}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className={confirmClass}
        >
          {busy ? "Processando…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
