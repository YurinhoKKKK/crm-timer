"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Label } from "@/lib/labels";
import { createLabel, updateLabel } from "../label-actions";
import Modal from "@/components/Modal";
import ColorPicker, { TEXT_PRESETS } from "@/components/ColorPicker";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";

// Modal de criar/editar etiqueta — usado tanto no gerenciador quanto no fluxo
// de criar etiqueta dentro da empresa. Ao salvar, chama onSaved com a etiqueta
// (para o chamador atualizar sua lista/seleção) e recarrega a rota.
export default function LabelDialog({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  // Presente = edição; ausente = criação.
  initial?: Label;
  onSaved?: (label: Label) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [bg, setBg] = useState(initial?.bg_color ?? "#4A2882");
  const [text, setText] = useState(initial?.text_color ?? "#FFFFFF");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = !!initial;

  async function save() {
    if (busy) return;
    if (!name.trim()) {
      setError("Informe o nome da etiqueta.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = { name, bgColor: bg, textColor: text };
      const res = editing
        ? await updateLabel(initial!.id, payload)
        : await createLabel(payload);
      if (res.error || !res.label) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      onSaved?.(res.label);
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} labelledBy="label-dialog-title">
      <h2 id="label-dialog-title" className="text-base font-semibold text-fg">
        {editing ? "Editar etiqueta" : "Nova etiqueta"}
      </h2>

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="label-name" className={labelClass}>
            Nome
          </label>
          <input
            id="label-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Ema"
            className={inputClass}
            autoFocus
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Prévia:</span>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium leading-none"
            style={{ backgroundColor: bg, color: text }}
          >
            {name.trim() || "Etiqueta"}
          </span>
        </div>

        <ColorPicker label="Cor de fundo" value={bg} onChange={setBg} />
        <ColorPicker
          label="Cor do texto"
          value={text}
          onChange={setText}
          presets={TEXT_PRESETS}
        />

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className={btnSecondary}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={btnPrimary}
        >
          {busy ? "Salvando…" : editing ? "Salvar" : "Criar etiqueta"}
        </button>
      </div>
    </Modal>
  );
}
