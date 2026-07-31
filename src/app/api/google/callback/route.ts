import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  verifyState,
  exchangeCode,
  expiryFromNow,
  NONCE_COOKIE,
  NONCE_COOKIE_PATH,
  GoogleError,
} from "@/lib/google-oauth";

// Retorno do Google. Ordem das checagens (todas antes de tocar em token):
//   1. erro explícito do Google (usuário recusou etc.)
//   2. state assinado válido (CSRF)
//   3. nonce do cookie httpOnly == nonce do state
//   4. sessão atual == uid do state (o callback é da MESMA sessão que iniciou)
// Só então troca o code por tokens e grava (cifrado) pela função DEFINER.
export const dynamic = "force-dynamic";

function back(
  request: NextRequest,
  status: "connected" | "error",
  detail?: string
) {
  const url = new URL("/perfil", request.url);
  url.searchParams.set("google", status);
  if (detail) url.searchParams.set("g_msg", detail);
  const res = NextResponse.redirect(url);
  // Nonce é de uso único: limpa sempre, sucesso ou erro.
  res.cookies.set(NONCE_COOKIE, "", { path: NONCE_COOKIE_PATH, maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // 1. O Google recusou / usuário cancelou
  const err = params.get("error");
  if (err) {
    return back(
      request,
      "error",
      err === "access_denied"
        ? "Conexão cancelada. Você não autorizou o Google Calendar."
        : "O Google recusou a conexão. Tente novamente."
    );
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return back(request, "error", "Retorno inválido do Google.");
  }

  // 2. state assinado
  const parsed = verifyState(state);
  if (!parsed) {
    return back(
      request,
      "error",
      "Sessão de conexão inválida ou expirada. Inicie a conexão de novo."
    );
  }

  // 3. nonce do cookie confere com o do state
  const cookieNonce = request.cookies.get(NONCE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== parsed.nonce) {
    return back(
      request,
      "error",
      "Não foi possível validar a origem da conexão. Inicie de novo."
    );
  }

  // 4. sessão atual é a mesma que iniciou
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return back(request, "error", "Faça login e conecte novamente.");
  }
  if (user.id !== parsed.uid) {
    return back(request, "error", "Esta conexão pertence a outra sessão.");
  }

  // 5. troca o code por tokens
  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    return back(
      request,
      "error",
      e instanceof GoogleError
        ? e.message
        : "Falha ao concluir a conexão com o Google."
    );
  }

  if (!tokens.access_token) {
    return back(request, "error", "O Google não devolveu um token válido.");
  }

  // 6. grava cifrado, via função SECURITY DEFINER, com a sessão do usuário.
  //    p_email vem do id_token (openid+email) — usado para exibir a conta e
  //    alertar divergência. refresh pode faltar em reconsentimento — a função
  //    preserva o refresh anterior nesse caso.
  const { error } = await supabase.rpc("google_upsert_account", {
    p_email: tokens.email,
    p_access: tokens.access_token,
    p_refresh: tokens.refresh_token,
    p_expiry: expiryFromNow(tokens.expires_in),
    p_scope: tokens.scope,
  });
  if (error) {
    return back(
      request,
      "error",
      "Conexão autorizada, mas não foi possível salvá-la. Tente de novo."
    );
  }

  return back(request, "connected");
}
