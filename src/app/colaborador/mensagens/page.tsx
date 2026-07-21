import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MessageInbox from "@/components/MessageInbox";
import { loadMessageInbox } from "@/lib/messages";

// Caixa de entrada do COLABORADOR (passo 32): as conversas das empresas em
// que ele tem tarefa (vínculo derivado — o mesmo do RLS cm_select). Decisão
// de produto: os três cargos recebem badge, coerente com o passo 31, em que
// o colaborador também responde ao cliente.
export default async function ColaboradorMensagensPage() {
  const { supabase, profile } = await guardRole(["colaborador"]);
  const rows = await loadMessageInbox(supabase);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Mensagens"
      subtitle="Conversas dos seus clientes, não lidas primeiro"
    >
      <MessageInbox role="colaborador" initial={rows} />
    </AppShell>
  );
}
