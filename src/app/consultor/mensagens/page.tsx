import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MessageInbox from "@/components/MessageInbox";
import { loadMessageInbox } from "@/lib/messages";

// Caixa de entrada do CONSULTOR (passo 32): só as conversas das empresas
// dele — o escopo é o RLS (cm_select), não filtro de interface.
export default async function ConsultorMensagensPage() {
  const { supabase, profile } = await guardRole(["consultor"]);
  const rows = await loadMessageInbox(supabase);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title="Mensagens"
      subtitle="Conversas com os seus clientes, não lidas primeiro"
    >
      <MessageInbox role="consultor" initial={rows} />
    </AppShell>
  );
}
