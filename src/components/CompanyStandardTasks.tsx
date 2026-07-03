"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskKind } from "@/lib/types";
import { setCompanyStandardTasks } from "@/app/admin/tarefas/standard-actions";
import { btnPrimary } from "@/lib/ui";
import AssignmentPicker, {
  KindBadge,
  collectAssignments,
  type PickerItem,
  type PickerRow,
} from "@/components/AssignmentPicker";

type StandardOption = { id: string; title: string; kind: TaskKind };
type PersonOption = { id: string; full_name: string; email: string };
type Assignment = { standardId: string; collaboratorId: string };
type Status = "idle" | "saving" | "saved" | "error";

// Seção "Tarefas padrão desta empresa": o admin/consultor escolhe quais padrões
// a empresa usa e o responsável de cada uma. Reutilizada na edição de empresa
// (admin) e na tela da empresa (consultor). A UI da seleção (checkbox, busca,
// "selecionar todas") vem do AssignmentPicker; a action valida no banco.
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

  const items: PickerItem[] = standards.map((s) => ({
    id: s.id,
    label: s.title,
    badge: <KindBadge kind={s.kind} />,
  }));

  const currentById = new Map(
    current.map((a) => [a.standardId, a.collaboratorId])
  );

  const [rows, setRows] = useState<Map<string, PickerRow>>(() => {
    const map = new Map<string, PickerRow>();
    for (const s of standards) {
      const assigned = currentById.get(s.id);
      map.set(s.id, {
        enabled: assigned !== undefined,
        collaboratorId: assigned ?? "",
      });
    }
    return map;
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleChange(next: Map<string, PickerRow>) {
    setRows(next);
    setStatus("idle");
  }

  async function save() {
    setErrorMsg(null);

    const { assignments, missing } = collectAssignments(items, rows);
    if (missing) {
      setStatus("error");
      setErrorMsg(`Escolha o responsável de "${missing.label}".`);
      return;
    }
    const payload: Assignment[] = assignments.map((a) => ({
      standardId: a.id,
      collaboratorId: a.collaboratorId,
    }));

    setStatus("saving");
    const { error } = await setCompanyStandardTasks(companyId, payload);
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
      <AssignmentPicker
        items={items}
        collaborators={collaborators}
        rows={rows}
        onChange={handleChange}
        searchPlaceholder="Buscar tarefa padrão…"
        idPrefix={`co-std-${companyId}`}
      />

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
