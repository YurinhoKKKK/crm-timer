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

// Seção "Tarefas padrão desta empresa" (fica na tela Editar empresa): o admin
// escolhe quais padrões a empresa usa e o responsável de cada uma. O seletor de
// responsável lista SÓ os colaboradores responsáveis da empresa (company_
// collaborators). Regras: 0 responsáveis ⇒ bloqueia e avisa; 1 ⇒ preenche
// sozinho e esconde o seletor; >1 ⇒ caixa de seleção só com eles. O servidor
// (assertResponsibles) recusa quem não é responsável — a UI só acompanha. A
// checagem só vale para vínculos CRIADOS/TROCADOS, então um responsável antigo
// que saiu da lista é PRESERVADO (mostrado como "fora da lista" para corrigir).
export default function CompanyStandardTasks({
  companyId,
  standards,
  collaborators,
  current,
  staleResponsibles = [],
}: {
  companyId: string;
  standards: StandardOption[];
  // SÓ os responsáveis atuais da empresa (opções válidas).
  collaborators: PersonOption[];
  current: Assignment[];
  // Responsáveis antigos, fora da lista atual, ainda gravados em alguma tarefa.
  staleResponsibles?: PersonOption[];
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

  // Sem responsável da empresa: não dá para atribuir tarefa padrão (o servidor
  // recusaria, e a regra de entrada em Ativos/Ema também exige colaborador).
  if (collaborators.length === 0) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
        Defina ao menos um{" "}
        <span className="font-medium">colaborador responsável</span> desta empresa
        (bloco acima) antes de atribuir tarefas padrão. Os responsáveis das tarefas
        padrão saem dessa lista.
      </div>
    );
  }

  // Exatamente um responsável: preenche sozinho e esconde o seletor por linha.
  const soleResponsibleId =
    collaborators.length === 1 ? collaborators[0].id : undefined;
  const staleOptions = staleResponsibles.map((p) => ({
    value: p.id,
    label: `${p.full_name || p.email} (fora da lista)`,
  }));

  return (
    <div>
      <AssignmentPicker
        items={items}
        collaborators={collaborators}
        rows={rows}
        onChange={handleChange}
        searchPlaceholder="Buscar tarefa padrão…"
        idPrefix={`co-std-${companyId}`}
        soleResponsibleId={soleResponsibleId}
        staleOptions={staleOptions}
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
