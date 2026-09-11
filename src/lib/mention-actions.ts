"use server";

import { createClient } from "@/lib/supabase-server";
import { avatarUrl } from "@/lib/avatar";
import {
  extractMentionIds,
  type MentionSourceType,
  type MentionUser,
} from "@/lib/mentions";

// Lista de quem PODE ser marcado no contexto — alimenta o seletor de @ do
// editor. A RPC mentionable_users (SECURITY DEFINER) se auto-gateia: se quem
// pede não alcança o contexto, volta vazio. companyId é nulo em chamado.
export async function fetchMentionableUsers(
  sourceType: MentionSourceType,
  companyId: string | null
): Promise<MentionUser[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.rpc("mentionable_users", {
    p_source_type: sourceType,
    p_company: companyId,
  });
  if (error || !data) return [];

  return (
    data as { id: string; full_name: string; avatar_path: string | null }[]
  ).map((r) => ({
    id: r.id,
    name: r.full_name,
    avatarUrl: avatarUrl(r.avatar_path),
  }));
}

// Tabela/coluna de conteúdo por contexto — o servidor RELÊ o conteúdo salvo
// (autoritativo) para extrair as menções, em vez de confiar numa lista do
// navegador.
const SOURCE_SPEC: Record<
  MentionSourceType,
  { table: string; column: string }
> = {
  atualizacao: { table: "company_notes", column: "content_html" },
  atualizacao_resposta: { table: "company_note_replies", column: "body_html" },
  chamado: { table: "support_tickets", column: "context_html" },
  chamado_resposta: { table: "support_ticket_replies", column: "body_html" },
};

// Reconcilia as menções de um conteúdo APÓS o salvamento. Lê o HTML salvo (sob
// a RLS do usuário — o autor alcança a própria fonte), extrai os ids e delega à
// RPC sync_content_mentions, que deriva a empresa da fonte, valida cada menção
// e persiste só as válidas. Chamada de melhor esforço: um erro aqui nunca
// desfaz o conteúdo já salvo (a menção é acessório do conteúdo).
export async function syncMentions(
  sourceType: MentionSourceType,
  sourceId: string
): Promise<void> {
  const spec = SOURCE_SPEC[sourceType];
  if (!spec) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await supabase
    .from(spec.table)
    .select(spec.column)
    .eq("id", sourceId)
    .single();
  if (error || !data) return;

  const html =
    (data as unknown as Record<string, string | null>)[spec.column] ?? "";
  const ids = extractMentionIds(html);

  // Mesmo com ids vazio: chamar limpa menções removidas do texto numa edição.
  await supabase.rpc("sync_content_mentions", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_user_ids: ids,
  });
}
