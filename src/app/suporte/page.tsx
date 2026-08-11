import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import SupportView from "./SupportView";
import { loadSupportTickets } from "@/lib/support";

// Chamados internos de suporte (Fatia 1) — o quadro do Monday no CRM. 100%
// interno: os TRÊS cargos veem TODOS os chamados (a RLS st_select escopa por
// cargo interno; pending/anon não leem). Não há variação por cargo — é a mesma
// página para todos.
//
// force-dynamic: os chamados e o status mudam a cada ação; a leitura inicial não
// deve servir de cache.
export const dynamic = "force-dynamic";

export default async function SuportePage() {
  const { supabase, profile } = await guardRole([
    "admin",
    "consultor",
    "colaborador",
  ]);

  const { tickets, counts, truncated } = await loadSupportTickets(supabase);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor" | "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Suporte"
      subtitle="Chamados internos da equipe"
    >
      <SupportView
        tickets={tickets}
        counts={counts}
        truncated={truncated}
        userId={profile.id}
        isAdmin={profile.role === "admin"}
      />
    </AppShell>
  );
}
