"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTaskTemplate } from "../../actions";
import { formatDuration } from "@/lib/format";

export default function DeleteTaskButton({
  templateId,
  title,
  totalSeconds = 0,
  instanceCount = 1,
  redirectTo = "/admin/tarefas",
}: {
  templateId: string;
  title: string;
  // Soma do tempo já registrado em todas as instâncias do molde.
  totalSeconds?: number;
  // Quantas instâncias (ocorrências) serão removidas junto.
  instanceCount?: number;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasTime = totalSeconds > 0;

  async function handleDelete() {
    setError(null);
    const { error: actionError } = await deleteTaskTemplate(templateId);

    if (actionError) {
      setError(actionError);
      return;
    }

    startTransition(() => {
      router.push(redirectTo);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-300 bg-surface px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/15"
      >
        Excluir tarefa
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {hasTime ? (
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          Esta tarefa tem {formatDuration(totalSeconds)} registrados
          {instanceCount > 1 ? ` em ${instanceCount} ocorrências` : ""}. Apagar
          removerá esse tempo permanentemente do total da empresa. Confirmar a
          exclusão de “{title}”?
        </p>
      ) : (
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          Confirma excluir a tarefa “{title}”? Esta ação não pode ser desfeita.
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Excluindo…" : "Sim, excluir"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={isPending}
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
