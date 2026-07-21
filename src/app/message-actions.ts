"use server";

import { createClient } from "@/lib/supabase-server";
import { loadCompanyMessages, type CompanyMessagePage } from "@/lib/messages";

// Lado INTERNO das mensagens (passo 31): a equipe responde pela conta
// autenticada, nunca pelo portal.
//
// INTEGRIDADE DE AUTORIA: author_type e author_id não vêm do navegador — o
// author_id é o auth.uid() da sessão, e a policy cm_insert_interno exige
// author_type='interno' E author_id = auth.uid(). Não existe WITH CHECK que
// aceite author_type='cliente' vindo de um usuário autenticado: por mais que
// alguém montasse o payload à mão, o banco recusaria.

export async function sendCompanyMessage(
  companyId: string,
  body: string
): Promise<{ error: string | null }> {
  const text = body.trim();
  if (!text) return { error: "Escreva uma mensagem." };
  if (text.length > 2000) {
    return { error: "A mensagem pode ter no máximo 2000 caracteres." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("company_messages").insert({
    company_id: companyId,
    body: text,
    author_type: "interno",
    author_id: user.id,
  });
  // A RLS recusa se o usuário não tiver vínculo com a empresa.
  if (error) {
    return { error: "Não foi possível enviar a mensagem." };
  }
  return { error: null };
}

// Página anterior da conversa ("ver mais"), escopada pela mesma RLS.
export async function companyMessagesPage(
  companyId: string,
  offset: number
): Promise<CompanyMessagePage | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return loadCompanyMessages(
    supabase,
    companyId,
    Math.max(0, Math.floor(offset))
  );
}
