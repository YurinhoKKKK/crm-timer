"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setCompanyCollaborators,
  type CollaboratorRemovalWarning,
} from "../actions";

type CollaboratorOption = { id: string; full_name: string; email: string };
type Status = "idle" | "saving" | "saved" | "error";

function sameSet(a: Set<string>, b: string[]): boolean {
  if (a.size !== b.length) return false;
  return b.every((id) => a.has(id));
}

// Colaboradores RESPONSÁVEIS pela empresa (vínculo declarado — mudança de
// âncora, migration 0090). Fica abaixo do seletor de consultores, no mesmo
// padrão. Só ADMIN vê e usa (a página é admin-only e a RLS reforça a escrita).
//
// Ao REMOVER alguém que ainda tem tarefas EM ABERTO na empresa, o servidor
// devolve um aviso com a contagem por pessoa; mostramos um diálogo de
// confirmação (nada é apagado — as tarefas seguem com a pessoa, só sem vínculo)
// e, se confirmado, reenviamos com confirmRemovals=true.
export default function CompanyCollaborators({
  companyId,
  collaborators,
  selectedIds,
}: {
  companyId: string;
  collaborators: CollaboratorOption[];
  selectedIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CollaboratorRemovalWarning[] | null>(
    null
  );
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
    setConfirm(null);
  }

  async function persist(confirmRemovals: boolean) {
    setStatus("saving");
    setErrorMsg(null);

    const { error, needsConfirm } = await setCompanyCollaborators(
      companyId,
      Array.from(selected),
      confirmRemovals
    );

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    if (needsConfirm && needsConfirm.length > 0) {
      setStatus("idle");
      setConfirm(needsConfirm);
      return;
    }

    setConfirm(null);
    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  if (collaborators.length === 0) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium text-fg">
          Colaboradores responsáveis
        </p>
        <p className="text-sm text-fg-subtle">
          Cadastre colaboradores para poder vinculá-los.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-fg">
        Colaboradores responsáveis
      </p>
      <p className="mb-2 text-xs text-fg-subtle">
        Define quem atende esta empresa — controla o acesso e quem pode receber
        tarefas aqui.
      </p>
      <div className="flex flex-wrap gap-2">
        {collaborators.map((c) => {
          const checked = selected.has(c.id);
          return (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                checked
                  ? "border-risd bg-brand-tint text-fg"
                  : "border-line bg-surface text-fg-muted hover:border-risd/50"
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
          onClick={() => persist(false)}
          disabled={!dirty || status === "saving"}
          className="rounded-lg bg-risd px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar responsáveis
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

      {confirm && (
        <div className="mt-3 rounded-xl border border-amber-400/60 bg-amber-50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Confirmar remoção de responsável
          </p>
          <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
            As tarefas em aberto abaixo ficarão <strong>sem vínculo</strong> (não
            são apagadas nem trocam de responsável — continuam com a pessoa, só
            fora da carteira dela nesta empresa):
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800/90 dark:text-amber-200/90">
            {confirm.map((w) => (
              <li key={w.collaboratorId}>
                <strong>{w.name}</strong>: {w.openTasks} tarefa
                {w.openTasks === 1 ? "" : "s"} em aberto
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => persist(true)}
              disabled={status === "saving"}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
            >
              Remover mesmo assim
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(new Set(selectedIds));
                setConfirm(null);
                setStatus("idle");
              }}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:text-fg"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
