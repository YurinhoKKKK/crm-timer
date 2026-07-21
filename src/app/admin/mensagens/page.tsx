import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MessageInbox from "@/components/MessageInbox";
import { loadMessageInbox } from "@/lib/messages";

// Caixa de entrada do ADMIN (passo 32): todas as conversas do sistema (o RLS
// libera tudo para admin). Clicar leva à aba Mensagens da central da empresa.
export default async function AdminMensagensPage() {
  const { supabase, profile } = await guardRole(["admin"]);
  const rows = await loadMessageInbox(supabase);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Mensagens"
      subtitle="Conversas com clientes, não lidas primeiro"
    >
      <MessageInbox role="admin" initial={rows} />
    </AppShell>
  );
}
