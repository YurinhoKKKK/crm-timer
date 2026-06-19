"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCompanyConsultants } from "../actions";

type ConsultantOption = { id: string; full_name: string; email: string };
type Status = "idle" | "saving" | "saved" | "error";

function sameSet(a: Set<string>, b: string[]): boolean {
  if (a.size !== b.length) return false;
  return b.every((id) => a.has(id));
}

export default function CompanyConsultants({
  companyId,
  consultores,
  selectedIds,
}: {
  companyId: string;
  consultores: ConsultantOption[];
  selectedIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dirty = !sameSet(selected, selectedIds);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    setErrorMsg(null);

    const { error } = await setCompanyConsultants(
      companyId,
      Array.from(selected)
    );

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  if (consultores.length === 0) {
    return (
      <p className="text-sm text-gunmetal/40">
        Cadastre consultores para poder atribuí-los.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gunmetal">
        Consultores responsáveis
      </p>
      <div className="flex flex-wrap gap-2">
        {consultores.map((c) => {
          const checked = selected.has(c.id);
          return (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                checked
                  ? "border-risd bg-brand-soft text-gunmetal"
                  : "border-platinum bg-white text-gunmetal/70 hover:border-risd/50"
              }`}
            >
              <input
                type="checkbox"
                className="accent-risd"
                checked={checked}
                onChange={() => toggle(c.id)}
              />
              {c.full_name || c.email}
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="rounded-lg bg-risd px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar atribuição
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saving" && (
            <span className="text-gunmetal/60">Salvando…</span>
          )}
          {status === "saved" && <span className="text-risd">Salvo</span>}
          {status === "error" && (
            <span className="text-red-600" title={errorMsg ?? undefined}>
              Erro ao salvar
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
