"use client";

import { useMemo, useState } from "react";
import type { Profile, Role } from "@/lib/types";
import RoleSelect from "./RoleSelect";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import {
  FilterBar,
  SearchBox,
  SelectFilter,
  EmptyState,
  norm,
} from "@/components/ListControls";

const ROLE_LABEL: Record<Role, string> = {
  pending: "Pendente",
  colaborador: "Colaborador",
  consultor: "Consultor",
  admin: "Admin",
};

export default function UserList({
  users,
  selfId,
}: {
  users: Profile[];
  selfId: string;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return users.filter((u) => {
      if (q && !norm(`${u.full_name ?? ""} ${u.email}`).includes(q)) return false;
      if (role && u.role !== role) return false;
      return true;
    });
  }, [users, query, role]);

  return (
    <>
      <FilterBar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar por nome ou e-mail…"
        />
        <SelectFilter
          value={role}
          onChange={setRole}
          allLabel="Todos os cargos"
          ariaLabel="Filtrar por cargo"
          options={[
            { value: "pending", label: "Pendente" },
            { value: "colaborador", label: "Colaborador" },
            { value: "consultor", label: "Consultor" },
            { value: "admin", label: "Admin" },
          ]}
        />
      </FilterBar>

      {users.length === 0 ? (
        <EmptyState>Nenhum usuário cadastrado ainda.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhum usuário corresponde aos filtros.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((u) => {
            const isPending = u.role === "pending";
            const isSelf = u.id === selfId;
            return (
              <li
                key={u.id}
                className={`flex flex-col gap-3 rounded-xl border p-4 shadow-card transition sm:flex-row sm:items-center sm:justify-between ${
                  isPending
                    ? "border-risd/30 bg-brand-tint"
                    : "border-line bg-surface"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={u.full_name || u.email}
                    url={avatarUrl(u.avatar_path)}
                    size={40}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">
                        {u.full_name || "(sem nome)"}
                      </span>
                      {isPending ? (
                        <span className="rounded-full bg-risd px-2 py-0.5 text-xs font-medium text-white">
                          Aguardando liberação
                        </span>
                      ) : (
                        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                          {ROLE_LABEL[u.role]}
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-xs text-fg-subtle">(você)</span>
                      )}
                    </div>
                    <p className="truncate text-sm text-fg-muted">{u.email}</p>
                  </div>
                </div>

                <RoleSelect userId={u.id} current={u.role} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
