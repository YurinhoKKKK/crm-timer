"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Label } from "@/lib/labels";
import { setCompanyLabels } from "../label-actions";
import LabelDialog from "./LabelDialog";

type Status = "idle" | "saving" | "saved" | "error";

function sameSet(a: Set<string>, b: string[]): boolean {
  if (a.size !== b.length) return false;
  return b.every((id) => a.has(id));
}

// Atribui etiquetas do catálogo à empresa. As tarefas herdam em tempo real, então
// salvar aqui reflete retroativamente em todas as tarefas da empresa. Também
// permite CRIAR uma etiqueta nova ali mesmo (botão "＋ Nova etiqueta").
export default function CompanyLabels({
  companyId,
  labels: initialLabels,
  selectedIds,
}: {
  companyId: string;
  labels: Label[];
  selectedIds: string[];
}) {
  const router = useRouter();
  // Catálogo em estado local para poder acrescentar uma etiqueta recém-criada
  // sem esperar o reload.
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [creating, setCreating] = useState(false);
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

  function onCreated(label: Label) {
    setLabels((prev) =>
      prev.some((l) => l.id === label.id)
        ? prev
        : [...prev, label].sort((a, b) =>
            a.name.localeCompare(b.name, "pt-BR")
          )
    );
    // Já marca a nova etiqueta como selecionada.
    setSelected((prev) => new Set(prev).add(label.id));
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    setErrorMsg(null);

    const { error } = await setCompanyLabels(companyId, Array.from(selected));

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-fg">Etiquetas</p>
      <p className="mb-3 text-xs text-fg-subtle">
        As etiquetas aparecem em todas as tarefas desta empresa automaticamente.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {labels.map((l) => {
          const checked = selected.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              aria-pressed={checked}
              className={`inline-flex items-center gap-1.5 rounded-full border transition ${
                l.highlight
                  ? "px-3 py-1.5 text-sm font-bold tracking-wide"
                  : "px-2.5 py-1 text-xs font-medium"
              } ${
                checked
                  ? "border-transparent ring-2 ring-risd ring-offset-1 ring-offset-surface"
                  : "border-line opacity-70 hover:opacity-100"
              }`}
              style={{ backgroundColor: l.bg_color, color: l.text_color }}
            >
              {l.name}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:border-risd/50 hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span aria-hidden="true">＋</span> Nova etiqueta
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="rounded-lg bg-risd px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar etiquetas
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saving" && <span className="text-fg-muted">Salvando…</span>}
          {status === "saved" && <span className="text-risd">Salvo</span>}
          {status === "error" && (
            <span
              className="text-red-600 dark:text-red-400"
              title={errorMsg ?? undefined}
            >
              Erro ao salvar
            </span>
          )}
        </span>
      </div>

      {creating && (
        <LabelDialog
          open
          onClose={() => setCreating(false)}
          onSaved={onCreated}
        />
      )}
    </div>
  );
}
