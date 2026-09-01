import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import ValidationQueue from "@/components/ValidationQueue";
import { fetchValidationQueue } from "@/app/validation-actions";

// Tela própria "Validações" do CONSULTOR: listagens a revisar só das empresas
// dele — o escopo é o RLS (lv_select), não filtro de interface. Antes vivia
// dentro da caixa de entrada de Mensagens; agora é tela própria.
export default async function ConsultorValidacoesPage() {
  const { profile } = await guardRole(["consultor"]);
  const queue = await fetchValidationQueue();

  return (
    <AppShell
      user={{ name: profile.full_name, role: "consultor", avatarUrl: profile.avatarUrl }}
      title="Validações"
      subtitle="Listagens que os seus clientes pediram para ajustar ou querem listar"
    >
      <ValidationQueue role="consultor" initial={queue} standalone />
    </AppShell>
  );
}
