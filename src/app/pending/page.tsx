import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";

export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  // Se já tem cargo, manda para o painel certo
  if (profile && profile.role !== "pending") redirect("/");

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-tint text-xl text-risd">
          ⏳
        </div>
        <h1 className="text-xl font-semibold text-fg">
          Conta aguardando liberação
        </h1>
        <p className="mt-2 text-fg-muted">
          Olá, {profile?.full_name}. Sua conta foi criada, mas ainda não tem um
          cargo. Um administrador precisa liberar seu acesso. Tente novamente
          mais tarde.
        </p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
