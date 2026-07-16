"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import {
  CLIENT_SESSION_COOKIE as SESSION_COOKIE,
  PORTAL_PROGRESS_PAGE,
  type PortalProgress,
} from "@/lib/client-portal";

// Ações do PORTAL DO CLIENTE (passo 25). O cliente não tem conta: o login
// valida token + senha no banco (client_portal_login, com trava anti força-
// bruta) e o segredo da sessão fica num cookie HttpOnly — nunca em URL nem
// acessível a JavaScript. A senha só trafega no corpo do POST (HTTPS).

export async function clientPortalLogin(
  token: string,
  password: string
): Promise<{ error: string | null }> {
  if (!token || !password) return { error: "Informe a senha." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_portal_login", {
    p_token: token,
    p_password: password,
  });
  if (error) return { error: "Não foi possível validar o acesso. Tente novamente." };

  const row = (data as { result: string; secret: string | null }[] | null)?.[0];
  if (row?.result === "ok" && row.secret) {
    cookies().set(SESSION_COOKIE, row.secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/cliente",
      maxAge: 7 * 24 * 60 * 60, // mesma validade da sessão no banco
    });
    return { error: null };
  }
  if (row?.result === "locked") {
    return {
      error:
        "Muitas tentativas de senha. Por segurança, o acesso ficou bloqueado por 15 minutos.",
    };
  }
  // Token inexistente/revogado e senha errada respondem igual (sem sondagem).
  return { error: "Senha incorreta ou link inválido." };
}

export async function clientPortalLogout(): Promise<void> {
  cookies().set(SESSION_COOKIE, "", { path: "/cliente", maxAge: 0 });
}

// Página seguinte do feed "Andamento" (passo 25.1). O segredo da sessão vem
// SEMPRE do cookie HttpOnly (nunca do client); client_portal_progress
// (SECURITY DEFINER) valida a sessão e escopa à empresa do token. Sessão
// inválida/expirada => null (o feed para de crescer; o refresh cai na senha).
export async function clientPortalProgressPage(
  token: string,
  offset: number
): Promise<PortalProgress | null> {
  const secret = cookies().get(SESSION_COOKIE)?.value ?? null;
  if (!secret || !token) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("client_portal_progress", {
    p_token: token,
    p_session: secret,
    p_limit: PORTAL_PROGRESS_PAGE,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  return (data as PortalProgress | null) ?? null;
}
