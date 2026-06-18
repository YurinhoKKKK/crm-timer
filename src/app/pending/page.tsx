import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";

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
    <main className="min-h-screen grid place-items-center px-4">
      <div className="max-w-md text-center">
        <div className="w-12 h-12 rounded-full bg-brand-soft grid place-items-center mx-auto mb-4">
          <span className="text-brand text-xl">⏳</span>
        </div>
        <h1 className="text-xl font-medium text-ink">
          Conta aguardando liberação
        </h1>
        <p className="text-ink/60 mt-2">
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
