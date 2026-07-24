import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MessageInbox from "@/components/MessageInbox";
import ValidationQueue from "@/components/ValidationQueue";
import { loadMessageInbox } from "@/lib/messages";
import { fetchValidationQueue } from "@/app/validation-actions";

// Caixa de entrada do CONSULTOR (passo 32 + 33): listagens a revisar e conversas
// só das empresas dele — o escopo é o RLS (lv_select / cm_select), não filtro
// de interface.
export default async function ConsultorMensagensPage() {
  const { supabase, profile } = await guardRole(["consultor"]);
  const [rows, queue] = await Promise.all([
    loadMessageInbox(supabase),
    fetchValidationQueue(),
  ]);

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title="Caixa de entrada"
      subtitle="Listagens a revisar e conversas com os seus clientes"
    >
      <ValidationQueue role="consultor" initial={queue} />
      <MessageInbox role="consultor" initial={rows} />
    </AppShell>
  );
}
