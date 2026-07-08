"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTaskTemplate } from "../../actions";
import { formatDuration } from "@/lib/format";
import ConfirmDialog from "@/components/ConfirmDialog";

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
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const hasTime = totalSeconds > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 bg-surface px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/15"
      >
        Excluir tarefa
      </button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Excluir a tarefa "${title}"?`}
        confirmLabel="Sim, excluir"
        description={
          hasTime ? (
            <>
              Esta tarefa tem{" "}
              <strong className="text-fg">{formatDuration(totalSeconds)}</strong>{" "}
              registrados
              {instanceCount > 1 ? ` em ${instanceCount} ocorrências` : ""}. Apagar
              removerá esse tempo permanentemente do total da empresa. Esta ação
              não pode ser desfeita.
            </>
          ) : (
            "Remove a tarefa e suas ocorrências de todos os painéis. Esta ação não pode ser desfeita."
          )
        }
        onConfirm={async () => {
          const { error } = await deleteTaskTemplate(templateId);
          if (error) return { error };
          startTransition(() => {
            router.push(redirectTo);
            router.refresh();
          });
        }}
      />
    </>
  );
}
