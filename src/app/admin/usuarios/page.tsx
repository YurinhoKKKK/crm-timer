import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Profile, Role } from "@/lib/types";
import RoleSelect from "./RoleSelect";

const ROLE_LABEL: Record<Role, string> = {
  pending: "Pendente",
  colaborador: "Colaborador",
  consultor: "Consultor",
  admin: "Admin",
};

// Ordem de exibição: pendentes primeiro (precisam de ação), depois por nome.
function sortProfiles(profiles: Profile[]): Profile[] {
  return [...profiles].sort((a, b) => {
    if (a.role === "pending" && b.role !== "pending") return -1;
    if (b.role === "pending" && a.role !== "pending") return 1;
    return (a.full_name || a.email).localeCompare(b.full_name || b.email, "pt-BR");
  });
}

export default async function UsuariosPage() {
  const { supabase, profile } = await guardRole(["admin"]);

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at, updated_at");

  const users = sortProfiles((data as Profile[]) ?? []);
  const pendingCount = users.filter((u) => u.role === "pending").length;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin" }}
      title="Gestão de usuários"
      subtitle="Atribua ou altere o cargo de cada pessoa. A mudança vale no próximo acesso dela."
      back={{ href: "/admin", label: "Dashboard" }}
    >
      {pendingCount > 0 && (
        <div className="mb-6 rounded-xl border border-risd/30 bg-brand-tint px-4 py-3 text-sm text-fg">
          <span className="font-medium">
            {pendingCount} usuário{pendingCount > 1 ? "s" : ""} aguardando
            liberação.
          </span>{" "}
          Defina um cargo para liberar o acesso.
        </div>
      )}

      {error ? (
        <div className="rounded-xl border border-red-300/60 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Erro ao carregar usuários: {error.message}
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-fg-subtle shadow-card">
          Nenhum usuário cadastrado ainda.
        </div>
      ) : (
        <ul className="space-y-3">
          {users.map((u) => {
            const isPending = u.role === "pending";
            const isSelf = u.id === profile.id;
            return (
              <li
                key={u.id}
                className={`flex flex-col gap-3 rounded-xl border p-4 shadow-card transition sm:flex-row sm:items-center sm:justify-between ${
                  isPending
                    ? "border-risd/30 bg-brand-tint"
                    : "border-line bg-surface"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">
                      {u.full_name || "(sem nome)"}
                    </span>
                    {isPending && (
                      <span className="rounded-full bg-risd px-2 py-0.5 text-xs font-medium text-white">
                        Aguardando liberação
                      </span>
                    )}
                    {!isPending && (
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

                <RoleSelect userId={u.id} current={u.role} />
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
