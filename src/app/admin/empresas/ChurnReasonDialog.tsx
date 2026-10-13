"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { btnSecondary } from "@/lib/ui";
import { CHURN_REASON_OPTIONS, type ChurnReason } from "@/lib/churn";

// Diálogo de MOTIVO ao mover empresa(s) para um grupo 'cancelado' (Controle de
// Churn, etapa 1). O motivo é obrigatório e vira o registro de churn no banco.
//
// Uma empresa: um passo só ("Motivo do cancelamento"). Várias: UMA empresa por
// vez ("Empresa N de M"), com "Voltar" para corrigir a anterior; só ao concluir a
// ÚLTIMA é que o pai efetiva (UMA chamada à RPC com todos os itens). Cancelar,
// Esc ou clicar fora em qualquer ponto = NENHUMA empresa é movida (o pai só move
// em onConfirm). O destino 'finalizado' não usa este diálogo (motivo automático).
export default function ChurnReasonDialog({
  companies,
  groupName,
  onCancel,
  onConfirm,
}: {
  companies: { id: string; name: string }[];
  groupName: string;
  onCancel: () => void;
  onConfirm: (reasons: Record<string, ChurnReason>) => void;
}) {
  const multi = companies.length > 1;
  const [index, setIndex] = useState(0);
  const [reasons, setReasons] = useState<Record<string, ChurnReason>>({});

  const current = companies[index];
  const chosen = reasons[current.id];
  const isLast = index === companies.length - 1;

  function advance() {
    if (!chosen) return;
    if (isLast) onConfirm(reasons);
    else setIndex((i) => i + 1);
  }

  return (
    <Modal open onClose={onCancel} labelledBy="churn-dialog-title" maxWidth="max-w-md">
      <div>
        {multi && (
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Empresa {index + 1} de {companies.length}
          </p>
        )}
        <h2 id="churn-dialog-title" className="mt-0.5 text-base font-semibold text-fg">
          Motivo do cancelamento
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Por que <strong className="text-fg">{current.name}</strong> está indo para{" "}
          <strong className="text-fg">{groupName}</strong>?
        </p>

        <div className="mt-4 space-y-1.5">
          {CHURN_REASON_OPTIONS.map((o) => {
            const active = chosen === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setReasons((r) => ({ ...r, [current.id]: o.value }))}
                aria-pressed={active}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                  active
                    ? "border-risd bg-brand-tint text-fg"
                    : "border-line text-fg-muted hover:border-risd/50 hover:text-fg"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-risd" : "border-line"
                  }`}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-risd" />}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <div>
            {multi && index > 0 && (
              <button type="button" onClick={() => setIndex((i) => i - 1)} className={btnSecondary}>
                Voltar
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className={btnSecondary}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={advance}
              disabled={!chosen}
              className="rounded-lg bg-risd px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
            >
              {multi ? (isLast ? "Concluir e mover" : "Avançar") : "Confirmar e mover"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
