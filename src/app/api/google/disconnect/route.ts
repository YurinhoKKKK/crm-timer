import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { revokeToken } from "@/lib/google-oauth";

// Desconectar: revoga DE FATO no Google e só então apaga a linha local, com
// auditoria. Se a revogação no Google não confirmar, ainda assim apagamos o
// token local (não deixamos o usuário preso) e deixamos a trilha 'erro_revogacao'
// para acompanhamento. Nunca falha em silêncio.
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sessão expirada. Faça login novamente." },
      { status: 401 }
    );
  }

  // Lê o token do PRÓPRIO usuário (função DEFINER filtra por auth.uid()).
  const { data, error } = await supabase.rpc("google_get_account");
  if (error) {
    return NextResponse.json(
      { error: "Não foi possível ler a conexão." },
      { status: 500 }
    );
  }
  const row = Array.isArray(data) ? data[0] : data;

  // Nada conectado: idempotente.
  if (!row) {
    return NextResponse.json({ ok: true, revoked: false, hadAccount: false });
  }

  // Revoga no Google (refresh derruba o grant inteiro; cai para o access se
  // não houver refresh). revokeToken nunca lança.
  const token: string | null = row.refresh_token ?? row.access_token ?? null;
  const revoked = token ? await revokeToken(token) : false;

  // Apaga a linha e audita 'revogado' (confirmado) ou 'desconectado'.
  const del = await supabase.rpc("google_delete_account", {
    p_revoked: revoked,
  });
  if (del.error) {
    return NextResponse.json(
      { error: "Não foi possível desconectar. Tente de novo." },
      { status: 500 }
    );
  }

  // Tínhamos token mas o Google não confirmou a revogação: deixa a trilha.
  if (token && !revoked) {
    await supabase.rpc("google_audit", {
      p_action: "erro_revogacao",
      p_detail: "Revogação no Google não confirmada; token local removido.",
    });
  }

  return NextResponse.json({ ok: true, revoked, hadAccount: true });
}
