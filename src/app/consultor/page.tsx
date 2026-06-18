import { guardRole } from "@/components/guardRole";
import LogoutButton from "@/components/LogoutButton";

export default async function ConsultorPage() {
  const { profile } = await guardRole(["consultor"]);

  return (
    <main className="min-h-screen p-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-medium text-ink">Painel do Consultor</h1>
          <p className="text-ink/50 text-sm">Bem-vindo, {profile.full_name}</p>
        </div>
        <LogoutButton />
      </header>
      <div className="rounded-xl border border-dashed border-ink/20 p-12 text-center text-ink/40">
        Seus clientes e cadastro de tarefas entram aqui.
        <br />Ver especificação em docs/ESPECIFICACAO.md
      </div>
    </main>
  );
}
