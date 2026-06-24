import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import type { Profile } from "@/lib/types";
import UserList from "./UserList";

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
    .select("id, full_name, email, role, avatar_path, created_at, updated_at");

  const users = sortProfiles((data as Profile[]) ?? []);
  const pendingCount = users.filter((u) => u.role === "pending").length;

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
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
      ) : (
        <UserList users={users} selfId={profile.id} />
      )}
    </AppShell>
  );
}
