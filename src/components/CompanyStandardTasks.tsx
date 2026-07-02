"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskKind } from "@/lib/types";
import { setCompanyStandardTasks } from "@/app/admin/tarefas/standard-actions";
import { inputClass, btnPrimary } from "@/lib/ui";

type StandardOption = {
  id: string;
  title: string;
  kind: TaskKind;
};
type PersonOption = { id: string; full_name: string; email: string };
type Assignment = { standardId: string; collaboratorId: string };
type Status = "idle" | "saving" | "saved" | "error";

type RowState = {
  enabled: boolean;
  collaboratorId: string;
  startDate: string;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Seção "Tarefas padrão desta empresa": o admin/consultor escolhe quais padrões
// a empresa usa e o responsável de cada uma. Reutilizada no cadastro/edição de
// empresa (admin) e na tela da empresa (consultor). A action valida no banco.
export default function CompanyStandardTasks({
  companyId,
  standards,
  collaborators,
  current,
}: {
  companyId: string;
  standards: StandardOption[];
  collaborators: PersonOption[];
  current: Assignment[];
}) {
  const router = useRouter();

  const currentById = new Map(current.map((a) => [a.standardId, a.collaboratorId]));

  const [rows, setRows] = useState<Map<string, RowState>>(() => {
    const map = new Map<string, RowState>();
    for (const s of standards) {
      const assigned = currentById.get(s.id);
      map.set(s.id, {
        enabled: assigned !== undefined,
        collaboratorId: assigned ?? "",
        startDate: todayISO(),
      });
    }
    return map;
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function update(id: string, patch: Partial<RowState>) {
    setRows((prev) => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id)!, ...patch });
      return next;
    });
    setStatus("idle");
  }

  async function save() {
    setErrorMsg(null);

    const assignments: (Assignment & { startDate?: string })[] = [];
    for (const s of standards) {
      const row = rows.get(s.id)!;
      if (!row.enabled) continue;
      if (!row.collaboratorId) {
        setStatus("error");
        setErrorMsg(`Escolha o responsável de "${s.title}".`);
        return;
      }
      assignments.push({
        standardId: s.id,
        collaboratorId: row.collaboratorId,
        startDate: row.startDate,
      });
    }

    setStatus("saving");
    const { error } = await setCompanyStandardTasks(companyId, assignments);
    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }
    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  if (standards.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        Nenhuma tarefa padrão no catálogo ainda.
      </p>
    );
  }

  if (collaborators.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        Cadastre ao menos um colaborador para atribuir tarefas padrão.
      </p>
    );
  }

  return (
    <div>
      <ul className="space-y-3">
        {standards.map((s) => {
          const row = rows.get(s.id)!;
          return (
            <li
              key={s.id}
              className={`rounded-xl border p-3 transition ${
                row.enabled
                  ? "border-risd/40 bg-brand-tint"
                  : "border-line bg-surface"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 accent-risd"
                  checked={row.enabled}
                  onChange={(e) => update(s.id, { enabled: e.target.checked })}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{s.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.kind === "diaria"
                          ? "bg-surface text-risd"
                          : "border border-line bg-surface-2 text-fg-muted"
                      }`}
                    >
                      {s.kind === "diaria" ? "Diária" : "Única"}
                    </span>
                  </span>
                </span>
              </label>

              {row.enabled && (
                <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`std-collab-${s.id}`}
                      className="mb-1 block text-xs font-medium text-fg-muted"
                    >
                      Responsável
                    </label>
                    <select
                      id={`std-collab-${s.id}`}
                      value={row.collaboratorId}
                      onChange={(e) =>
                        update(s.id, { collaboratorId: e.target.value })
                      }
                      className={inputClass}
                    >
                      <option value="">Selecione…</option>
                      {collaborators.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || p.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  {s.kind === "unica" && !currentById.has(s.id) && (
                    <div>
                      <label
                        htmlFor={`std-date-${s.id}`}
                        className="mb-1 block text-xs font-medium text-fg-muted"
                      >
                        Data
                      </label>
                      <input
                        id={`std-date-${s.id}`}
                        type="date"
                        value={row.startDate}
                        onChange={(e) =>
                          update(s.id, { startDate: e.target.value })
                        }
                        className={inputClass}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          className={btnPrimary}
        >
          {status === "saving" ? "Salvando…" : "Salvar tarefas padrão"}
        </button>
        <span className="text-xs" aria-live="polite">
          {status === "saved" && <span className="text-risd">Salvo</span>}
          {status === "error" && errorMsg && (
            <span className="text-red-600 dark:text-red-400">{errorMsg}</span>
          )}
        </span>
      </div>
    </div>
  );
}
