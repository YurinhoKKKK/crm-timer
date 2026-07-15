"use server";

import { createClient } from "@/lib/supabase-server";

// Gestão do acesso do cliente (passo 25) — admin e consultor da empresa.
// Toda a lógica sensível (gerar token, hash bcrypt da senha, derrubar
// sessões) mora nas funções SECURITY DEFINER do banco, que revalidam a
// permissão; aqui só repassamos. A senha nunca aparece em URL/logs.

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

// Cria o acesso ou redefine a senha (mantém o link; derruba sessões ativas).
export async function setClientAccess(
  companyId: string,
  password: string
): Promise<{ error: string | null; token?: string }> {
  if (password.trim().length < 8) {
    return { error: "A senha deve ter pelo menos 8 caracteres." };
  }
  const res = await authedRpc<string>("client_portal_set", {
    p_company: companyId,
    p_password: password,
  });
  return res.error ? { error: res.error } : { error: null, token: res.data };
}

// Gera um NOVO link (o antigo morre na hora) e derruba as sessões.
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
