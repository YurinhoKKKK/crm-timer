"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAttendanceEnabled } from "../actions";

// Chave "Cronômetro de atendimento" de um usuário (calibração, 0126). Otimista,
// reverte na falha — mesmo padrão do RoleSelect. Rótulo textual (a cor não é o
// único sinal: o estado também aparece como "Ligado/Desligado").
export default function AttendanceToggle({
  userId,
  initial,
}: {
  userId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [, startTransition] = useTransition();

  async function toggle() {
    const next = !on;
    const previous = on;
    setOn(next);
    setStatus("saving");
    const { error } = await updateAttendanceEnabled(userId, next);
    if (error) {
      setOn(previous);
      setStatus("error");
      return;
    }
    setStatus("idle");
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Cronômetro de atendimento"
        onClick={toggle}
        disabled={status === "saving"}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 ${
          on ? "bg-risd" : "border border-line bg-surface-2"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <span className="text-xs text-fg-muted">
        Cronômetro de atendimento:{" "}
        <span className="font-medium text-fg">{on ? "Ligado" : "Desligado"}</span>
        {status === "error" && (
          <span className="ml-1 text-red-600 dark:text-red-400">· erro ao salvar</span>
        )}
      </span>
    </div>
  );
}
