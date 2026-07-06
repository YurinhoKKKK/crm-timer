"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Combobox, { type ComboOption } from "@/components/Combobox";
import { inputClass, labelClass, hintClass } from "@/lib/ui";

type Group = { id: string; name: string; number: string | null };
type Mode = "loading" | "list" | "manual";

// Seleção do grupo de WhatsApp. Tenta carregar os grupos da Digisac via Edge
// Function (digisac-groups); se falhar, cai no preenchimento manual para não
// travar o cadastro.
export default function GroupSelect({
  contactId,
  groupName,
  onChange,
}: {
  contactId: string;
  groupName: string;
  onChange: (contactId: string, groupName: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("loading");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("digisac-groups");

      if (cancelled) return;

      if (error || !data || (data as { error?: string }).error) {
        const msg =
          (data as { error?: string } | null)?.error ??
          error?.message ??
          "Não foi possível carregar os grupos.";
        setLoadError(msg);
        setMode("manual");
        return;
      }

      setGroups(((data as { groups?: Group[] }).groups ?? []) as Group[]);
      setMode("list");
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSelect(id: string) {
    if (!id) {
      onChange("", "");
      return;
    }
    // Mantém o nome atual se for o "órfão" (salvo manualmente antes).
    if (id === contactId) {
      onChange(id, groupName);
      return;
    }
    const group = groups.find((g) => g.id === id);
    onChange(id, group?.name ?? "");
  }

  if (mode === "loading") {
    return (
      <div>
        <span className={labelClass}>Grupo de WhatsApp</span>
        <p className="text-sm text-fg-subtle">Carregando grupos da Digisac…</p>
      </div>
    );
  }

  if (mode === "list") {
    // Se o contactId atual não está na lista (ex.: salvo manualmente antes),
    // mostramos uma opção extra para não perdê-lo.
    const knownIds = new Set(groups.map((g) => g.id));
    const orphan = contactId && !knownIds.has(contactId);

    const options: ComboOption[] = [
      { value: "", label: "— Nenhum —" },
      ...(orphan
        ? [{ value: contactId, label: `${groupName || "(grupo atual)"} (atual)` }]
        : []),
      ...groups.map((g) => ({
        value: g.id,
        label: g.name,
        hint: g.number ?? undefined,
      })),
    ];

    return (
      <div>
        <label htmlFor="group-select" className={labelClass}>
          Grupo de WhatsApp <span className={hintClass}>(opcional)</span>
        </label>
        <Combobox
          id="group-select"
          value={contactId}
          onChange={handleSelect}
          options={options}
          ariaLabel="Grupo de WhatsApp"
          placeholder="— Nenhum —"
          searchPlaceholder="Buscar grupo…"
        />
        <button
          type="button"
          onClick={() => setMode("manual")}
          className="mt-1 text-xs text-fg-subtle underline-offset-2 hover:text-risd hover:underline"
        >
          Inserir manualmente
        </button>
      </div>
    );
  }

  // mode === "manual"
  return (
    <div className="space-y-3">
      {loadError && (
        <p className="text-xs text-fg-subtle">
          Não foi possível listar os grupos da Digisac ({loadError}). Preencha
          manualmente.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="manual-group" className={labelClass}>
            Nome do grupo <span className={hintClass}>(opcional)</span>
          </label>
          <input
            id="manual-group"
            type="text"
            value={groupName}
            onChange={(e) => onChange(contactId, e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="manual-contact" className={labelClass}>
            contactId da Digisac <span className={hintClass}>(opcional)</span>
          </label>
          <input
            id="manual-contact"
            type="text"
            value={contactId}
            onChange={(e) => onChange(e.target.value, groupName)}
            className={inputClass}
          />
        </div>
      </div>
      {groups.length > 0 && (
        <button
          type="button"
          onClick={() => setMode("list")}
          className="text-xs text-fg-subtle underline-offset-2 hover:text-risd hover:underline"
        >
          Escolher da lista
        </button>
      )}
    </div>
  );
}
