import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import MessageInbox from "@/components/MessageInbox";
import ValidationQueue from "@/components/ValidationQueue";
import { loadMessageInbox } from "@/lib/messages";
import { fetchValidationQueue } from "@/app/validation-actions";

// Caixa de entrada do COLABORADOR (passo 32 + 33): as conversas das empresas em
// que ele tem tarefa (vínculo derivado) e as listagens sob responsabilidade DELE
// que o cliente pediu para ajustar/listar — aqui o vínculo é direto (lv_select),
// mais estreito que o das mensagens: ele só vê a fila das próprias listagens.
export default async function ColaboradorMensagensPage() {
  const { supabase, profile } = await guardRole(["colaborador"]);
  const [rows, queue] = await Promise.all([
    loadMessageInbox(supabase),
    fetchValidationQueue(),
  ]);

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Caixa de entrada"
      subtitle="Listagens a revisar e conversas dos seus clientes"
    >
      <ValidationQueue role="colaborador" initial={queue} />
      <MessageInbox role="colaborador" initial={rows} />
    </AppShell>
  );
}
