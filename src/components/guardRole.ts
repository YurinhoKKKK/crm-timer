import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { avatarUrl } from "@/lib/avatar";
import { perfRoute } from "@/lib/perf";

type Role = "admin" | "consultor" | "colaborador";

// Garante que o usuário logado tem um dos cargos permitidos.
// Retorna o profile (com avatarUrl já resolvido); redireciona caso contrário.
//
// Custo: DUAS idas ao Supabase, em cascata (getUser valida o JWT no servidor de
// auth pela rede; só depois lê o profile). Toda página paga isso ANTES de
// começar a buscar os próprios dados — por isso está instrumentado à parte.
export async function guardRole(allowed: Role[]) {
  const perf = perfRoute("guardRole (todas as telas)");
  const supabase = await createClient();
  const {
    data: { user },
  } = await perf.timed("auth.getUser (rede → auth server)", supabase.auth.getUser());
  if (!user) redirect("/login");

  const { data: profile } = await perf.timed(
    "profiles (meu perfil)",
    supabase
      .from("profiles")
      .select("id, full_name, role, avatar_path")
      .eq("id", user.id)
      .single()
  );
  perf.done();

  if (!profile || profile.role === "pending") redirect("/pending");
  if (!allowed.includes(profile.role as Role)) redirect("/");

  return {
    supabase,
    profile: { ...profile, avatarUrl: avatarUrl(profile.avatar_path) },
  };
}
