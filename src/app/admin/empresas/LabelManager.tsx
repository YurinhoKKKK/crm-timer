"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Label } from "@/lib/labels";
import { deleteLabel } from "../label-actions";
import LabelDialog from "./LabelDialog";
import ConfirmDialog from "@/components/ConfirmDialog";

// Gerenciador compacto de etiquetas (na tela de Empresas). As etiquetas
// aparecem como chips; clicar no chip edita, o × remove (com confirmação
// estilizada). Criar/editar acontece num modal, para não dominar a tela.
export default function LabelManager({ labels }: { labels: Label[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Label | null>(null);
  const [removing, setRemoving] = useState<Label | null>(null);
  const [, startTransition] = useTransition();

  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Etiquetas</h2>
          <p className="text-xs text-fg-muted">
            Classifique empresas com etiquetas coloridas — elas aparecem em todas
            as tarefas da empresa.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span aria-hidden="true" className="text-base leading-none">
            +
          </span>
          Nova etiqueta
        </button>
      </div>

      {labels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {labels.map((l) => (
            <span
              key={l.id}
              className="group inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-1 text-xs font-medium leading-none"
              style={{ backgroundColor: l.bg_color, color: l.text_color }}
            >
              <button
                type="button"
                onClick={() => setEditing(l)}
                className="rounded outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                title={`Editar "${l.name}"`}
              >
                {l.name}
              </button>
              <button
                type="button"
                onClick={() => setRemoving(l)}
                aria-label={`Remover etiqueta ${l.name}`}
                title={`Remover "${l.name}"`}
                className="flex h-4 w-4 items-center justify-center rounded-full opacity-60 transition hover:bg-black/20 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Criar (montado só quando aberto → campos limpos a cada abertura) */}
      {creating && <LabelDialog open onClose={() => setCreating(false)} />}

      {/* Editar */}
      {editing && (
        <LabelDialog
          key={editing.id}
          open
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Remover */}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remover a etiqueta "${removing?.name}"?`}
        description="Ela sairá de todas as empresas e, por consequência, de todas as tarefas. Esta ação não pode ser desfeita."
        confirmLabel="Remover etiqueta"
        onConfirm={async () => {
          if (!removing) return;
          const res = await deleteLabel(removing.id);
          if (res.error) return { error: res.error };
          startTransition(() => router.refresh());
        }}
      />
    </section>
  );
}
