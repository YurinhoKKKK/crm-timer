"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import { CLIENT_SESSION_COOKIE as SESSION_COOKIE } from "@/lib/client-portal";

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
