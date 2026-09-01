-- =====================================================================
-- REMOÇÃO do módulo de mensagens cliente ↔ equipe
--
-- Decisão de produto: o contato com o cliente passa a ser centralizado no
-- WhatsApp/Digisac. A troca de mensagens dentro do sistema deixa de existir,
-- tanto interna quanto no portal do cliente.
--
-- IRREVERSÍVEL. As 38 mensagens (+ 7 marcações de leitura) existentes eram
-- TODAS de teste, na empresa "Teste Yuri"; remoção autorizada pelo Mauricio. O
-- conteúdo íntegro das duas tabelas foi salvo ANTES de rodar isto em
-- supabase/backups/0068_company_messages_backup_pre_drop.sql.
--
-- NÃO TOCA em listing_validations nem em listing_validation_reads (validação de
-- listagem é fluxo de trabalho ativo e vive em tabelas próprias).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Badge: my_unread_total deixa de somar mensagens
-- ---------------------------------------------------------------------
-- O badge da sidebar (agora só na tela "Validações") já usa
-- my_unread_validations() direto. Redefinimos my_unread_total() ANTES de
-- derrubar my_unread_messages() para tirar a dependência; mantê-la (em vez de
-- dropá-la) preserva os tipos gerados e qualquer chamador residual — que passa
-- a contar só validações, sem número errado silencioso.
create or replace function my_unread_total()
returns bigint
language sql stable security invoker set search_path = public
as $$
  select my_unread_validations();
$$;

revoke execute on function my_unread_total() from public, anon;
grant execute on function my_unread_total() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Funções que dependem das tabelas de mensagens
-- ---------------------------------------------------------------------
-- Caixa de entrada + contador internos (migrations 0035/0036).
drop function if exists message_inbox();
drop function if exists my_unread_messages();

-- Caminho do portal e da pré-visualização (migrations 0033/0034).
drop function if exists client_portal_messages(text, text, integer, integer);
drop function if exists client_portal_message_send(text, text, text, text, text);
drop function if exists client_portal_preview_messages(uuid, integer, integer);
drop function if exists client_portal_messages_since(text, text, timestamptz);

-- ---------------------------------------------------------------------
-- 3. Realtime: tira company_messages da publication antes do drop
-- ---------------------------------------------------------------------
-- (company_message_reads nunca esteve na publication.) ALTER PUBLICATION não
-- aceita IF EXISTS no DROP TABLE, então guardamos num DO que só remove se a
-- tabela ainda estiver na publication (idempotente).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'company_messages'
  ) then
    alter publication supabase_realtime drop table company_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Dados + tabelas (as policies caem junto com as tabelas)
-- ---------------------------------------------------------------------
delete from company_message_reads;
delete from company_messages;

drop table if exists company_message_reads;
drop table if exists company_messages;
