"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setUserLink } from "../actions";

export type DigisacUserRow = {
  id: string;
  digisac_name: string | null;
  email: string | null;
  msgs: number;
  profile_id: string | null;
  profile_name: string | null;
  profile_locked: boolean;
};

export type ProfileOption = { id: string; full_name: string };

const AUTO = "__auto__";
const NONE = "__none__";

export default function PeopleLinkTable({
  users,
  profiles,
}: {
  users: DigisacUserRow[];
  profiles: ProfileOption[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Valor atual do seletor: automático (destravado) / nenhum (travado sem perfil)
  // / id do perfil (travado).
  function currentValue(u: DigisacUserRow): string {
    if (!u.profile_locked) return AUTO;
    return u.profile_id ?? NONE;
  }

  async function onChange(u: DigisacUserRow, value: string) {
    setBusyId(u.id);
    setError(null);
    const res =
      value === AUTO
        ? await setUserLink(u.id, null, true)
        : value === NONE
          ? await setUserLink(u.id, null, false)
          : await setUserLink(u.id, value, false);
    setBusyId(null);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
              <th className="px-4 py-2 font-medium">Usuário Digisac</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 text-right font-medium">Mensagens</th>
              <th className="px-3 py-2 font-medium">Ligação</th>
              <th className="px-4 py-2 font-medium">Perfil do CRM</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-fg-subtle">
                  Nenhum usuário do Digisac ainda.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-line/60">
                  <td className="px-4 py-2 text-fg">{u.digisac_name ?? "—"}</td>
                  <td className="px-3 py-2 text-fg-muted">{u.email ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {u.msgs.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">
                    {u.profile_locked ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                        manual
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                        automático
                      </span>
                    )}
                    {!u.profile_id && (
                      <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-subtle">
                        sem perfil
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={currentValue(u)}
                        onChange={(e) => onChange(u, e.target.value)}
                        disabled={busyId === u.id}
                        className="w-full max-w-xs rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-fg shadow-sm focus:border-risd focus:outline-none focus:ring-1 focus:ring-risd disabled:opacity-60"
                      >
                        <option value={AUTO}>Automático (por e-mail)</option>
                        <option value={NONE}>Nenhum</option>
                        <optgroup label="Travar em um perfil">
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      {busyId === u.id && <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-subtle">
        <strong>Automático</strong>: casa pelo e-mail na sincronização.{" "}
        <strong>Nenhum</strong>: trava sem perfil (não entra na comparação).{" "}
        Travar em um perfil sobrepõe o e-mail. A mudança reflete na comparação na hora —
        as estimativas são guardadas por usuário do Digisac e o perfil é resolvido na leitura.
      </p>
    </div>
  );
}
