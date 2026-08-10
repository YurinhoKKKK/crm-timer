"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import GroupColorPicker from "./GroupColorPicker";
import { DEFAULT_GROUP_COLOR, type CompanyGroup } from "@/lib/company-groups";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";

// Diálogo de criar / editar grupo (nome + cor). Serve o botão "Novo grupo" e os
// itens de menu "Renomear" / "Trocar cor" (ambos abrem aqui). O erro de nome
// repetido chega da ação como texto claro — nunca o erro cru do Postgres.
export default function GroupDialog({
  open,
  mode,
  group,
  focusColor,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  group?: CompanyGroup | null;
  // "Trocar cor" foca a cor; "Renomear"/"Novo grupo" focam o nome.
  focusColor?: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; color: string }) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reinicia os campos a cada abertura, conforme o modo.
  useEffect(() => {
    if (!open) return;
    setName(mode === "edit" ? group?.name ?? "" : "");
    setColor(mode === "edit" ? group?.color ?? DEFAULT_GROUP_COLOR : DEFAULT_GROUP_COLOR);
    setError(null);
    if (!focusColor) setTimeout(() => nameRef.current?.focus(), 0);
  }, [open, mode, group, focusColor]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onSubmit({ name, color });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} labelledBy="group-dialog-title">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 id="group-dialog-title" className="text-base font-semibold text-fg">
          {mode === "create" ? "Novo grupo" : "Editar grupo"}
        </h2>

        <div>
          <label htmlFor="group-name" className={labelClass}>
            Nome
          </label>
          <input
            id="group-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Ex.: Ativos, Pausados, Cancelados…"
            className={inputClass}
          />
        </div>

        <GroupColorPicker value={color} onChange={setColor} />

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={btnSecondary}
          >
            Cancelar
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "Salvando…" : mode === "create" ? "Criar grupo" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
