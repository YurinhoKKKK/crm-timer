import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import PeopleLinkTable, { type DigisacUserRow, type ProfileOption } from "./PeopleLinkTable";

// Ligação manual Digisac → perfil (admin). A ligação manual tem prioridade e não é
// sobrescrita pelo casamento por e-mail da sincronização (coluna profile_locked).

export default async function PessoasPage() {
  const { supabase, profile } = await guardRole(["admin"]);

  const [{ data: users }, { data: profiles }] = await Promise.all([
    supabase.rpc("digisac_users_admin_list"),
    supabase.from("profiles").select("id, full_name").order("full_name"),
  ]);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Pessoas do Digisac"
      subtitle="Ligue cada usuário do Digisac ao perfil do CRM. A ligação manual não é sobrescrita pela sincronização."
      back={{ href: "/admin/atendimento-calibracao", label: "Calibração" }}
    >
      <PeopleLinkTable
        users={(users as DigisacUserRow[]) ?? []}
        profiles={(profiles as ProfileOption[]) ?? []}
      />
    </AppShell>
  );
}
