import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  buildAuthUrl,
  newNonce,
  signState,
  NONCE_COOKIE,
  NONCE_COOKIE_PATH,
  GoogleError,
} from "@/lib/google-oauth";

// Início do fluxo: exige sessão, gera o nonce (cookie httpOnly) e o state
// assinado, e manda o usuário ao Google. O par nonce(cookie)+state(assinado) é
// o que o callback confere para recusar callback avulso ou de outra sessão.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let authUrl: string;
  try {
    const nonce = newNonce();
    authUrl = buildAuthUrl(signState({ uid: user.id, nonce }));

    const res = NextResponse.redirect(authUrl);
    res.cookies.set(NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // sobrevive ao retorno (navegação top-level GET) do Google
      path: NONCE_COOKIE_PATH,
      maxAge: 600,
    });
    return res;
  } catch (e) {
    // Tipicamente configuração ausente no servidor (env). Volta com mensagem.
    const msg =
      e instanceof GoogleError
        ? e.message
        : "Não foi possível iniciar a conexão com o Google.";
    const url = new URL("/perfil", request.url);
    url.searchParams.set("google", "error");
    url.searchParams.set("g_msg", msg);
    return NextResponse.redirect(url);
  }
}
