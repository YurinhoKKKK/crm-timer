-- =====================================================================
-- REUNIÕES — correção do INSERT ... RETURNING (bug de criar reunião).
--
-- SINTOMA: criar reunião falhava SEMPRE, até para admin/consultor da própria
-- empresa, com Postgres 42501 ("new row violates row-level security policy for
-- table meetings"). A mensagem antiga chutava "sem acesso à empresa" e mandava
-- caçar a coisa errada — o acesso à empresa estava correto.
--
-- CAUSA RAIZ (comprovada em transação com rollback):
--   A action grava com `.insert(...).select("id").single()`, que o PostgREST
--   compila para `INSERT ... RETURNING id`. O RETURNING faz o Postgres aplicar a
--   policy de SELECT (meetings_select => meeting_is_visible(id)) à linha recém
--   inserida. Mas meeting_is_visible é STABLE SECURITY DEFINER e RE-CONSULTA a
--   própria tabela:  exists (select 1 from meetings m where m.id = p_meeting).
--   Essa releitura roda no snapshot da instrução de INSERT, que NÃO enxerga a
--   linha que está sendo inserida => exists = false => visibilidade negada =>
--   42501. Sem o RETURNING o INSERT passa; com ele, falha.  (INSERT sem
--   returning: OK. INSERT ... returning: 42501. Provado nos dois sentidos.)
--
--   O `exists(select 1 from meetings ...)` também era REDUNDANTE como policy de
--   SELECT: ela só roda para linhas que já estão em `meetings`, então o exists é
--   sempre verdadeiro numa leitura normal — só quebra no RETURNING.
--
-- CORREÇÃO: a decisão de produto da Fatia 1 (migration 0046) já é "todo interno
-- AUTENTICADO vê TODAS as reuniões". Então a visibilidade é exatamente
-- `auth.uid() is not null` — sem reler a tabela. Isso conserta o RETURNING,
-- preserva o portal do cliente fora (anon => auth.uid() nulo => nada aparece) e
-- mantém a não-recursão que a 0044 buscou (não referencia meetings nem
-- meeting_participants). Vale para as duas policies que usam a função
-- (meetings_select e mp_select).
-- =====================================================================

create or replace function meeting_is_visible(p_meeting uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  -- Fatia 1: qualquer usuário interno autenticado vê todas as reuniões. NÃO
  -- relê `meetings` (o self-read quebrava o INSERT ... RETURNING; ver cabeçalho).
  -- p_meeting fica no contrato porque as policies chamam meeting_is_visible(id)
  -- / meeting_is_visible(meeting_id); a visibilidade hoje não depende de qual é.
  select auth.uid() is not null;
$$;

revoke execute on function meeting_is_visible(uuid) from public, anon;
grant  execute on function meeting_is_visible(uuid) to authenticated;
