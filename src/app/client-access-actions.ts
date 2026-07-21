"use server";

import { createClient } from "@/lib/supabase-server";

// Gestão do acesso do cliente (passos 25 e 30) — EXCLUSIVA DE ADMIN.
//
// Toda a lógica sensível (sortear a senha, hash bcrypt, gerar/girar token,
// derrubar sessões, auditar) mora nas funções SECURITY DEFINER do banco, que
// revalidam is_admin() por conta própria. Estas actions são um repasse: se
// alguém chamá-las com outro cargo, o banco recusa — a autorização não
// depende de nenhuma checagem daqui.
//
// A senha em claro existe UMA ÚNICA VEZ: no retorno de generateClientAccess,
// atravessando a action até a tela que a revela. Ela nunca é gravada, nunca
// vai para URL e nunca volta em nenhuma leitura posterior.

async function authedRpc<T>(
  fn: string,
  args: Record<string, unknown>
): Promise<{ error: string | null; data?: T }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  return { error: null, data: data as T };
}

// Cria o acesso ou redefine a senha. Devolve o link e a senha sorteada —
// única aparição dela. Quem esquecer, redefine (e isso fica na auditoria).
export async function generateClientAccess(
  companyId: string
): Promise<{ error: string | null; token?: string; password?: string }> {
  const res = await authedRpc<{ token: string; password: string }>(
    "client_portal_set",
    { p_company: companyId }
  );
  if (res.error) return { error: res.error };
  return {
    error: null,
    token: res.data?.token,
    password: res.data?.password,
  };
}

// Gera um NOVO link (o antigo morre na hora) e derruba as sessões. A senha
// continua a mesma.
export async function rotateClientAccess(
  companyId: string
): Promise<{ error: string | null; token?: string }> {
  const res = await authedRpc<string>("client_portal_rotate", {
    p_company: companyId,
  });
  return res.error ? { error: res.error } : { error: null, token: res.data };
}

// Revoga o acesso: o link para de funcionar e as sessões caem.
export async function revokeClientAccess(
  companyId: string
): Promise<{ error: string | null }> {
  const res = await authedRpc<null>("client_portal_revoke", {
    p_company: companyId,
  });
  return { error: res.error };
}
