"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCompany } from "../../actions";

export default function DeleteCompanyButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    setError(null);
    const { error: actionError } = await deleteCompany(companyId);

    if (actionError) {
      setError(actionError);
      return;
    }

    startTransition(() => {
      router.push("/admin/empresas");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
      >
        Excluir empresa
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-red-800">
        Confirma excluir “{companyName}” e todos os dados ligados a ela?
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="rounded-lg border border-platinum bg-white px-4 py-2 text-sm text-gunmetal/70 transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
