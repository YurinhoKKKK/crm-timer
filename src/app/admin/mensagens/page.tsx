import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MessageInbox from "@/components/MessageInbox";
import ValidationQueue from "@/components/ValidationQueue";
import { loadMessageInbox } from "@/lib/messages";
import { fetchValidationQueue } from "@/app/validation-actions";

// Caixa de entrada do ADMIN (passo 32 + 33): as listagens a revisar (validações
// do cliente em aberto) e todas as conversas do sistema (o RLS libera tudo para
// admin). Clicar leva à central da empresa.
export default async function AdminMensagensPage() {
  const { supabase, profile } = await guardRole(["admin"]);
  const [rows, queue] = await Promise.all([
    loadMessageInbox(supabase),
    fetchValidationQueue(),
  ]);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Caixa de entrada"
      subtitle="Listagens a revisar e conversas com clientes"
    >
      <ValidationQueue role="admin" initial={queue} />
      <MessageInbox role="admin" initial={rows} />
    </AppShell>
  );
}
