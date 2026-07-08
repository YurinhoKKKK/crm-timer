"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCompany } from "../../actions";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function DeleteCompanyButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 bg-surface px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/15"
      >
        Excluir empresa
      </button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Excluir "${companyName}"?`}
        confirmLabel="Sim, excluir"
        description="Remove a empresa e, em cascata, os vínculos de consultores, as etiquetas e todas as tarefas (templates e instâncias) ligadas a ela. Esta ação não pode ser desfeita."
        onConfirm={async () => {
          const { error } = await deleteCompany(companyId);
          if (error) return { error };
          startTransition(() => {
            router.push("/admin/empresas");
            router.refresh();
          });
        }}
      />
    </>
  );
}
