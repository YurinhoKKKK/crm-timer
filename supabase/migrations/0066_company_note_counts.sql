-- ---------------------------------------------------------------------
-- Contagem de anotações por empresa, para o balão de atalho nas listas de
-- empresas (tela do admin) e nos cartões do consultor.
--
-- UMA consulta agregada no banco para TODAS as empresas da tela — nunca uma
-- consulta por empresa (a lista do admin tem 120+), e nunca contar array no
-- cliente (o PostgREST trunca em 1000 sem aviso; ver §7 da ESPECIFICACAO).
--
-- SECURITY INVOKER de propósito: o escopo é o MESMO da aba de Anotações — a
-- RLS `cn_select` já filtra as linhas (admin todas, consultor as da carteira,
-- colaborador as empresas onde tem tarefa) ANTES do count. Nenhum caminho novo
-- de leitura: a função só reagrupa o que o usuário já poderia ler.
--
-- Empresas sem anotação simplesmente NÃO aparecem no retorno; a tela assume 0.
-- ---------------------------------------------------------------------
create or replace function company_note_counts()
returns table (company_id uuid, note_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select company_id, count(*)
  from company_notes
  group by company_id;
$$;

grant execute on function company_note_counts() to authenticated;
