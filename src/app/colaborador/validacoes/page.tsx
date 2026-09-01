import { guardRole } from "@/components/guardRole";
import AppShell from "@/components/AppShell";
import ValidationQueue from "@/components/ValidationQueue";
import { fetchValidationQueue } from "@/app/validation-actions";

// Tela própria "Validações" do COLABORADOR: as listagens sob responsabilidade
// DELE que o cliente pediu para ajustar/listar — vínculo direto (lv_select), mais
// estreito que o das antigas mensagens. Antes vivia dentro da caixa de entrada de
// Mensagens; agora é tela própria.
export default async function ColaboradorValidacoesPage() {
  const { profile } = await guardRole(["colaborador"]);
  const queue = await fetchValidationQueue();

  return (
    <AppShell
      user={{
        name: profile.full_name,
        role: "colaborador",
        avatarUrl: profile.avatarUrl,
      }}
      title="Validações"
      subtitle="Listagens sob sua responsabilidade que o cliente pediu para ajustar ou quer listar"
    >
      <ValidationQueue role="colaborador" initial={queue} standalone />
    </AppShell>
  );
}
