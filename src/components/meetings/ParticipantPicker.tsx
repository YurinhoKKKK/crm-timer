"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import { SearchBox, norm } from "@/components/ListControls";
import type { DirectoryUser } from "@/lib/meetings";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  consultor: "Consultor",
  colaborador: "Colaborador",
};

// Multi-seleção de participantes internos, com busca e foto. Controlado: o pai
// guarda o Set de ids selecionados. Roster vem de meeting_directory() (o cliente
// nunca recebe e-mail — só nome/foto/cargo).
export default function ParticipantPicker({
  users,
  selected,
  onChange,
}: {
  users: DirectoryUser[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const q = norm(query.trim());
  const filtered = q ? users.filter((u) => norm(u.name).includes(q)) : users;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        Nenhum outro usuário interno disponível.
      </p>
    );
  }

  const scroll = users.length > 8;

  return (
    <div className="space-y-3">
      {users.length > 6 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar pessoa…"
        />
      )}
      <p className="text-xs text-fg-subtle">
        {selected.size} participante{selected.size === 1 ? "" : "s"} selecionado
        {selected.size === 1 ? "" : "s"}
      </p>
      {filtered.length === 0 ? (
        <p className="py-3 text-center text-sm text-fg-subtle">
          Ninguém corresponde à busca.
        </p>
      ) : (
        <ul
          className={`space-y-1.5 ${scroll ? "max-h-64 overflow-y-auto pr-1" : ""}`}
        >
          {filtered.map((u) => {
            const on = selected.has(u.id);
            return (
              <li key={u.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition ${
                    on
                      ? "border-risd/40 bg-brand-tint"
                      : "border-line bg-surface hover:border-risd/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-risd"
                    checked={on}
                    onChange={() => toggle(u.id)}
                  />
                  <Avatar name={u.name} url={u.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {u.name}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
