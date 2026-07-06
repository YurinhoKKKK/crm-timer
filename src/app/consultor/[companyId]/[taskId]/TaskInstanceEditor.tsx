"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTaskInstance } from "../../actions";
import Combobox from "@/components/Combobox";
import { inputClass, labelClass, hintClass, btnPrimary } from "@/lib/ui";

type PersonOption = { id: string; full_name: string; email: string };
type SaveStatus = "idle" | "saving" | "saved" | "error";

// ISO (UTC) -> valor de <input type="datetime-local"> no horário local.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// Valor de datetime-local (horário local) -> ISO (UTC) ou null se vazio.
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function TaskInstanceEditor({
  taskId,
  companyId,
  initial,
  collaborators,
}: {
  taskId: string;
  companyId: string;
  initial: {
    title: string;
    description: string | null;
    instructions: string | null;
    due_at: string | null;
    collaborator_id: string;
  };
  collaborators: PersonOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [instructions, setInstructions] = useState(initial.instructions ?? "");
  const [dueAtLocal, setDueAtLocal] = useState(isoToLocalInput(initial.due_at));
  const [collaboratorId, setCollaboratorId] = useState(initial.collaborator_id);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);

    const { error } = await updateTaskInstance(taskId, companyId, {
      title,
      description,
      instructions,
      dueAt: localInputToIso(dueAtLocal),
      collaboratorId,
    });

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ti-title" className={labelClass}>
          Título
        </label>
        <input
          id="ti-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ti-description" className={labelClass}>
          Descrição <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="ti-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ti-instructions" className={labelClass}>
          Instruções <span className={hintClass}>(opcional)</span>
        </label>
        <textarea
          id="ti-instructions"
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ti-due" className={labelClass}>
            Prazo <span className={hintClass}>(opcional)</span>
          </label>
          <input
            id="ti-due"
            type="datetime-local"
            value={dueAtLocal}
            onChange={(e) => setDueAtLocal(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ti-collaborator" className={labelClass}>
            Colaborador
          </label>
          <Combobox
            id="ti-collaborator"
            value={collaboratorId}
            onChange={setCollaboratorId}
            options={collaborators.map((p) => ({
              value: p.id,
              label: p.full_name || p.email,
            }))}
            ariaLabel="Colaborador"
            searchPlaceholder="Buscar colaborador…"
          />
        </div>
      </div>

      {status === "error" && errorMsg && (
        <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={status === "saving"} className={btnPrimary}>
          {status === "saving" ? "Salvando…" : "Salvar alterações"}
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saved" && <span className="text-risd">Salvo</span>}
        </span>
      </div>
    </form>
  );
}
