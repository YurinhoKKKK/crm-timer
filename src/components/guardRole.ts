import { cache } from "react";
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { avatarUrl } from "@/lib/avatar";
import { perfRoute } from "@/lib/perf";

type Role = "admin" | "consultor" | "colaborador";

// Quem é o usuário desta requisição: DUAS idas ao Supabase, em cascata (getUser
// valida o JWT no servidor de auth pela rede; só depois dá para ler o profile
// pelo id). Toda página paga isso ANTES de buscar os próprios dados — por isso
// está instrumentado à parte.
//
// `cache()` memoiza POR REQUISIÇÃO: se algo mais no mesmo render precisar saber
// quem é o usuário, reaproveita este resultado em vez de repetir as duas idas.
// Hoje cada página chama guardRole uma única vez, então isto não economiza
// nada — é uma trava para o futuro (um layout por área, um componente de
// servidor compartilhado, um segundo guard numa mesma página). Sem ela, o
// segundo chamador custaria ~100ms silenciosamente.
//
// IMPORTANTE: o que é memoizado é só a LEITURA de identidade — idempotente e
// sem efeito colateral. A decisão de autorização fica fora, em guardRole, e
// roda de novo a cada chamada.
const loadCurrentUser = cache(async () => {
  const perf = perfRoute("guardRole (todas as telas)");
  const supabase = await createClient();

  const {
    data: { user },
  } = await perf.timed(
    "auth.getUser (rede → auth server)",
    supabase.auth.getUser()
  );
  if (!user) {
    perf.done();
    return { supabase, signedIn: false, profile: null };
  }

  const { data: profile } = await perf.timed(
    "profiles (meu perfil)",
    supabase
      .from("profiles")
      .select("id, full_name, role, avatar_path")
      .eq("id", user.id)
      .single()
  );
  perf.done();

  return { supabase, signedIn: true, profile };
});

// Garante que o usuário logado tem um dos cargos permitidos.
// Retorna o profile (com avatarUrl já resolvido); redireciona caso contrário.
//
// A checagem de cargo abaixo roda SEMPRE, em toda chamada, mesmo quando a
// identidade veio do cache — `allowed` muda de página para página e nunca entra
// na memoização. Cada página continua garantindo a própria autorização.
export async function guardRole(allowed: Role[]) {
  const { supabase, signedIn, profile } = await loadCurrentUser();

  // Mesma ordem de decisão de antes: sem sessão vai para o login; com sessão
  // mas sem profile (ou ainda `pending`) vai para a tela de espera.
  if (!signedIn) redirect("/login");
  if (!profile || profile.role === "pending") redirect("/pending");
  if (!allowed.includes(profile.role as Role)) redirect("/");

  return {
    supabase,
    profile: { ...profile, avatarUrl: avatarUrl(profile.avatar_path) },
  };
}
