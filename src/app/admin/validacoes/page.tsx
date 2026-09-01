import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import ValidationQueue from "@/components/ValidationQueue";
import { fetchValidationQueue } from "@/app/validation-actions";

// Tela própria "Validações" do ADMIN: listagens que o cliente pediu para ajustar
// ou quer listar. Escopo é do banco (listing_validation_queue é SECURITY INVOKER,
// herda lv_select): admin vê todas. Antes vivia dentro da caixa de entrada de
// Mensagens; agora é tela própria.
export default async function AdminValidacoesPage() {
  const { profile } = await guardRole(["admin"]);
  const queue = await fetchValidationQueue();

  return (
    <AppShell
      user={{ name: profile.full_name, role: "admin", avatarUrl: profile.avatarUrl }}
      title="Validações"
      subtitle="Listagens que o cliente pediu para ajustar ou quer listar"
    >
      <ValidationQueue role="admin" initial={queue} standalone />
    </AppShell>
  );
}
