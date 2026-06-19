import Link from "next/link";
import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";
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
    <main className="min-h-screen bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/admin"
              className="text-sm text-gunmetal/60 transition hover:text-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 rounded"
            >
              ← Painel
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-gunmetal">
              Gestão de usuários
            </h1>
            <p className="text-sm text-gunmetal/60">
              Atribua ou altere o cargo de cada pessoa. A mudança vale no próximo
              acesso dela.
            </p>
          </div>
          <LogoutButton />
        </header>

        {pendingCount > 0 && (
          <div className="mb-6 rounded-lg border border-risd/30 bg-brand-soft px-4 py-3 text-sm text-gunmetal">
            <span className="font-medium">
              {pendingCount} usuário{pendingCount > 1 ? "s" : ""} aguardando
              liberação.
            </span>{" "}
            Defina um cargo para liberar o acesso.
          </div>
        )}

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Erro ao carregar usuários: {error.message}
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-platinum bg-white p-12 text-center text-gunmetal/50 shadow-sm">
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
                  className={`flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition sm:flex-row sm:items-center sm:justify-between ${
                    isPending
                      ? "border-risd/30 bg-brand-soft"
                      : "border-platinum bg-white"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gunmetal">
                        {u.full_name || "(sem nome)"}
                      </span>
                      {isPending && (
                        <span className="rounded-full bg-risd px-2 py-0.5 text-xs font-medium text-white">
                          Aguardando liberação
                        </span>
                      )}
                      {!isPending && (
                        <span className="rounded-full border border-platinum bg-paper px-2 py-0.5 text-xs text-gunmetal/70">
                          {ROLE_LABEL[u.role]}
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-xs text-gunmetal/40">(você)</span>
                      )}
                    </div>
                    <p className="truncate text-sm text-gunmetal/60">{u.email}</p>
                  </div>

                  <RoleSelect userId={u.id} current={u.role} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
