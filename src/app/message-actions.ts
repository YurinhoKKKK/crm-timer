"use server";

import { createClient } from "@/lib/supabase-server";
import {
  loadCompanyMessages,
  loadMessageInbox,
  type CompanyMessagePage,
  type InboxRow,
} from "@/lib/messages";

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

// Ressincronização da caixa de entrada (passo 32.1): a MESMA consulta que
// alimenta o render inicial no servidor, agora acionável pelo componente vivo
// (Realtime/foco). Badge e lista saem de message_inbox() — fonte única.
export async function fetchMessageInbox(): Promise<InboxRow[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return loadMessageInbox(supabase);
}

// Marca a conversa como lida PARA ESTE USUÁRIO (passo 32). A marcação é por
// usuário — se o admin lê, o consultor não perde a notificação. RLS: só a
// própria linha, e só de empresa a que o usuário tem acesso.
export async function markMessagesRead(
  companyId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("company_message_reads").upsert(
    {
      user_id: user.id,
      company_id: companyId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,company_id" }
  );
  return { error: error ? "Não foi possível marcar como lida." : null };
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
