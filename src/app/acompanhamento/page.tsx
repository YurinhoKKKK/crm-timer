import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import FollowupView from "@/components/followup/FollowupView";
import { loadFollowup, clampPeriod } from "@/lib/followup";

// Acompanhamento de clientes — monitora se TODOS os clientes estão sendo
// atendidos de forma constante ("quais estão esfriando?"), não ranqueia ninguém.
// Admin vê todas as empresas; consultor só a carteira dele (escopo garantido no
// banco pela RLS companies_select dentro da RPC client_followup, SECURITY
// INVOKER). Colaborador não acessa (guardRole barra).
//
// force-dynamic: os dados mudam a cada contato; o período vem da URL (estado de
// visão, como periodo/status noutras telas) e refaz a agregação no servidor.
export const dynamic = "force-dynamic";

export default async function AcompanhamentoPage({
  searchParams,
}: {
  searchParams: { periodo?: string | string[] };
}) {
  const { supabase, profile } = await guardRole(["admin", "consultor"]);
  const period = clampPeriod(searchParams.periodo);
  const rows = await loadFollowup(supabase, period);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: profile.role as "admin" | "consultor",
        avatarUrl: profile.avatarUrl,
      }}
      title="Acompanhamento de clientes"
      subtitle="Quem está esfriando — para atender de forma constante, não para ranquear."
    >
      <FollowupView
        rows={rows}
        period={period}
        role={profile.role as "admin" | "consultor"}
      />
    </AppShell>
  );
}
