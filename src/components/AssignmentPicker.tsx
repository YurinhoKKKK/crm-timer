"use client";

import { useState, type ReactNode } from "react";
import { SearchBox, norm } from "@/components/ListControls";
import Combobox from "@/components/Combobox";

// Seletor genérico "lista com checkbox + responsável por item", reutilizado nas
// duas direções do vínculo empresa↔tarefa padrão (Passo 20):
//  - Direção 2: itens = tarefas padrão, dentro do formulário de empresa.
//  - Direção 1: itens = empresas, dentro da tela da tarefa padrão (com o atalho
//    "responsável padrão" ligado).
// É totalmente controlado: o pai guarda o Map de linhas e coleta na hora de
// salvar. Search e "selecionar todas" cuidam da escala (muitas empresas/padrões).

export type PersonOption = { id: string; full_name: string; email: string };
export type PickerItem = { id: string; label: string; badge?: ReactNode };
export type PickerRow = { enabled: boolean; collaboratorId: string };

// A partir de quantos itens vale a pena mostrar busca / rolagem interna.
const SEARCH_THRESHOLD = 6;
const SCROLL_THRESHOLD = 8;

export function emptyRows(): Map<string, PickerRow> {
  return new Map();
}

export default function AssignmentPicker({
  items,
  collaborators,
  rows,
  onChange,
  searchPlaceholder,
  responsibleLabel = "Responsável",
  showDefaultResponsible = false,
  idPrefix,
}: {
  items: PickerItem[];
  collaborators: PersonOption[];
  rows: Map<string, PickerRow>;
  onChange: (next: Map<string, PickerRow>) => void;
  searchPlaceholder: string;
  responsibleLabel?: string;
  showDefaultResponsible?: boolean;
  idPrefix: string;
}) {
  const [query, setQuery] = useState("");
  const [defaultResp, setDefaultResp] = useState("");

  const collabOptions = collaborators.map((p) => ({
    value: p.id,
    label: p.full_name || p.email,
  }));

  const q = norm(query.trim());
  const filtered = q ? items.filter((it) => norm(it.label).includes(q)) : items;

  function getRow(id: string): PickerRow {
    return rows.get(id) ?? { enabled: false, collaboratorId: "" };
  }

  function mutate(id: string, patch: Partial<PickerRow>) {
    const next = new Map(rows);
    next.set(id, { ...getRow(id), ...patch });
    onChange(next);
  }

  // Ao marcar um item, herda o responsável padrão se ainda não tiver um.
  function toggleOne(id: string, enabled: boolean) {
    const cur = getRow(id);
    mutate(id, {
      enabled,
      collaboratorId:
        enabled && !cur.collaboratorId ? defaultResp : cur.collaboratorId,
    });
  }

  const selectedCount = items.filter((it) => getRow(it.id).enabled).length;
  const allFilteredEnabled =
    filtered.length > 0 && filtered.every((it) => getRow(it.id).enabled);

  // "Selecionar todas" age só sobre o subconjunto filtrado (o que está à vista).
  function toggleAll(enabled: boolean) {
    const next = new Map(rows);
    for (const it of filtered) {
      const cur = next.get(it.id) ?? { enabled: false, collaboratorId: "" };
      next.set(it.id, {
        enabled,
        collaboratorId:
          enabled && !cur.collaboratorId ? defaultResp : cur.collaboratorId,
      });
    }
    onChange(next);
  }

  // Atalho (Direção 1): pré-preenche o responsável de todas as linhas marcadas,
  // sem impedir o ajuste individual depois.
  function applyDefault(value: string) {
    setDefaultResp(value);
    if (!value) return;
    const next = new Map(rows);
    for (const it of items) {
      const cur = next.get(it.id);
      if (cur?.enabled) next.set(it.id, { ...cur, collaboratorId: value });
    }
    onChange(next);
  }

  if (items.length === 0) return null;

  const showSearch = items.length > SEARCH_THRESHOLD;
  const scroll = items.length > SCROLL_THRESHOLD;

  return (
    <div className="space-y-3">
      {showDefaultResponsible && (
        <div>
          <label
            htmlFor={`${idPrefix}-default`}
            className="mb-1 block text-xs font-medium text-fg-muted"
          >
            Responsável padrão{" "}
            <span className="font-normal text-fg-subtle">
              (aplica a todas as marcadas)
            </span>
          </label>
          <Combobox
            id={`${idPrefix}-default`}
            value={defaultResp}
            onChange={applyDefault}
            options={collabOptions}
            ariaLabel="Responsável padrão"
            searchPlaceholder="Buscar responsável…"
          />
        </div>
      )}

      {showSearch && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={searchPlaceholder}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input
            type="checkbox"
            className="accent-risd"
            checked={allFilteredEnabled}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          Selecionar todas
          {q && <span className="text-fg-subtle">(visíveis)</span>}
        </label>
        <span className="text-xs text-fg-subtle">
          {selectedCount} de {items.length} selecionada
          {items.length === 1 ? "" : "s"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-fg-subtle">
          Nenhum item corresponde à busca.
        </p>
      ) : (
        <ul
          className={`space-y-2 ${
            scroll ? "max-h-80 overflow-y-auto pr-1" : ""
          }`}
        >
          {filtered.map((it) => {
            const row = getRow(it.id);
            return (
              <li
                key={it.id}
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
                    onChange={(e) => toggleOne(it.id, e.target.checked)}
                  />
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{it.label}</span>
                    {it.badge}
                  </span>
                </label>

                {row.enabled && (
                  <div className="mt-3 pl-7">
                    <label
                      htmlFor={`${idPrefix}-collab-${it.id}`}
                      className="mb-1 block text-xs font-medium text-fg-muted"
                    >
                      {responsibleLabel}
                    </label>
                    <Combobox
                      id={`${idPrefix}-collab-${it.id}`}
                      value={row.collaboratorId}
                      onChange={(v) => mutate(it.id, { collaboratorId: v })}
                      options={collabOptions}
                      ariaLabel={responsibleLabel}
                      searchPlaceholder="Buscar responsável…"
                    />

                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Badge visual do tipo da tarefa padrão (Única/Diária), reutilizável nos itens.
export function KindBadge({ kind }: { kind: "unica" | "diaria" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        kind === "diaria"
          ? "bg-surface text-risd"
          : "border border-line bg-surface-2 text-fg-muted"
      }`}
    >
      {kind === "diaria" ? "Diária" : "Única"}
    </span>
  );
}

// Coleta as atribuições válidas (marcadas + com responsável) e aponta a primeira
// linha marcada sem responsável, para validação no pai.
export function collectAssignments(
  items: PickerItem[],
  rows: Map<string, PickerRow>
): { assignments: { id: string; collaboratorId: string }[]; missing: PickerItem | null } {
  const assignments: { id: string; collaboratorId: string }[] = [];
  for (const it of items) {
    const row = rows.get(it.id);
    if (!row?.enabled) continue;
    if (!row.collaboratorId) return { assignments: [], missing: it };
    assignments.push({ id: it.id, collaboratorId: row.collaboratorId });
  }
  return { assignments, missing: null };
}
