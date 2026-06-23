"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";
import { updateUserRole } from "../actions";

const ROLES: { value: Role; label: string }[] = [
  { value: "pending", label: "Pendente" },
  { value: "colaborador", label: "Colaborador" },
  { value: "consultor", label: "Consultor" },
  { value: "admin", label: "Admin" },
];

type Status = "idle" | "saving" | "saved" | "error";

export default function RoleSelect({
  userId,
  current,
  disabled = false,
}: {
  userId: string;
  current: Role;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(current);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Role;
    const previous = role;

    setRole(next);
    setStatus("saving");
    setErrorMsg(null);

    const { error } = await updateUserRole(userId, next);

    if (error) {
      setRole(previous); // reverte na falha
      setStatus("error");
      setErrorMsg(error);
      return;
    }

    setStatus("saved");
    startTransition(() => router.refresh());
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Alterar cargo"
        value={role}
        onChange={handleChange}
        disabled={disabled || status === "saving"}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      <span className="min-w-[5.5rem] text-xs" aria-live="polite">
        {status === "saving" && (
          <span className="text-fg-muted">Salvando…</span>
        )}
        {status === "saved" && <span className="text-risd">Salvo</span>}
        {status === "error" && (
          <span className="text-red-600 dark:text-red-400" title={errorMsg ?? undefined}>
            Erro ao salvar
          </span>
        )}
      </span>
    </div>
  );
}
