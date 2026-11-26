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

  // 5b. ESCOPO DA AGENDA é obrigatório (B12/0174). O Google permite desmarcar
  // permissões no consentimento; sem calendar.events.owned a conexão fica "meia"
  // (cria reunião → "insufficient authentication scopes", importa nada). Nesse
  // caso NÃO consideramos conectado: nada é gravado e pedimos para refazer
  // marcando a permissão de agenda. Casos reais: Filipe Peres, Camilli.
  if (!tokens.scope.includes("calendar.events.owned")) {
    return back(
      request,
      "error",
      "A permissão de agenda não foi concedida. Conecte de novo e MARQUE a caixa de acesso ao Google Agenda na tela do Google."
    );
  }

  // 6. grava cifrado, via função SECURITY DEFINER, com a sessão do usuário.
  //    google_connect_account (0177) valida no servidor: conta já em uso por
  //    outro usuário, troca bloqueada por reunião futura na conta atual, e — na
  //    troca permitida — zera o estado de sync, apaga o espelho da conta antiga,
  //    audita 'conta_trocada' e libera o auto-sync se não houver nada a
  //    reconciliar. p_email vem do id_token; refresh pode faltar em
  //    reconsentimento (a função preserva o anterior).
  const { data, error } = await supabase.rpc("google_connect_account", {
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

  const result = (data ?? {}) as {
    status?: string;
    count?: number;
    email?: string;
  };

  // Conta Google já ligada a outro usuário do CRM: nada foi salvo (FALHA 3.1).
  if (result.status === "conta_em_uso") {
    return back(
      request,
      "error",
      "Esta conta Google já está conectada a outro usuário do CRM."
    );
  }

  // Troca bloqueada por reuniões futuras na conta atual: nada foi salvo (FALHA 3.2).
  if (result.status === "troca_bloqueada") {
    const n = result.count ?? 0;
    const email = result.email ?? "atual";
    const reunioes = n === 1 ? "1 reunião futura" : `${n} reuniões futuras`;
    return back(
      request,
      "error",
      `Você tem ${reunioes} na conta ${email}. Para trocar de conta, exclua ou remarque essas reuniões antes ou fale com o administrador.`
    );
  }

  return back(request, "connected");
}
