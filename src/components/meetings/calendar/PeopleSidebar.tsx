"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import { SearchBox, norm } from "@/components/ListControls";
import { personColor } from "@/lib/meeting-colors";
import type { DirectoryUser } from "@/lib/meetings";

// Painel "Agendas" (como o "Minhas agendas" do Google): liga/desliga a agenda de
// cada pessoa na grade. Ao abrir, vem marcado SÓ o próprio usuário — o resto o
// usuário liga para comparar. Cada pessoa tem a sua cor consistente.
export default function PeopleSidebar({
  people,
  selected,
  currentUserId,
  onToggle,
  onOnlyMe,
}: {
  people: DirectoryUser[];
  selected: Set<string>;
  currentUserId: string;
  onToggle: (id: string) => void;
  onOnlyMe: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = norm(query.trim());

  // "Eu" sempre no topo; o resto em ordem alfabética (já vem assim do diretório).
  const ordered = [...people].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return 0;
  });
  const filtered = q ? ordered.filter((u) => norm(u.name).includes(q)) : ordered;

  const onlyMe = selected.size === 1 && selected.has(currentUserId);

  return (
    <aside className="flex w-full flex-col rounded-2xl border border-line bg-surface p-4 shadow-card lg:w-64">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Agendas</h3>
        {!onlyMe && (
          <button
            type="button"
            onClick={onOnlyMe}
            className="text-xs font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            Só eu
          </button>
        )}
      </div>

      {people.length > 6 && (
        <div className="mb-2">
          <SearchBox value={query} onChange={setQuery} placeholder="Buscar pessoa…" />
        </div>
      )}

      <ul className="-mr-1 max-h-[60vh] space-y-0.5 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <li className="py-2 text-center text-xs text-fg-subtle">
            Ninguém corresponde à busca.
          </li>
        ) : (
          filtered.map((u) => {
            const on = selected.has(u.id);
            const color = personColor(u.id);
            return (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(u.id)}
                    style={{ accentColor: color }}
                    className="h-4 w-4 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
                  />
                  <Avatar name={u.name} url={u.avatarUrl} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="text-fg-subtle"> (você)</span>
                    )}
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color, opacity: on ? 1 : 0.25 }}
                    aria-hidden="true"
                  />
                </label>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}
