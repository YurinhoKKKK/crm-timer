-- =====================================================================
-- "Minhas Listagens" do COLABORADOR — visão única, cruzando empresas
-- =====================================================================
-- Primeira tela do sistema em que um colaborador vê dados ATRAVESSANDO
-- empresas. O isolamento por executor é a única barreira, então precisa ser
-- à prova de falha e viver no BANCO — não na interface.
--
-- GARANTIA DE ISOLAMENTO (dupla, e a de baixo é a que vale):
--  1. SECURITY INVOKER: a função roda com a RLS do chamador. listing_results
--     (lr_select) herda ti_select; para um colaborador, ti_select só devolve
--     collaborator_id = auth.uid(). listing_brands (lb_select) herda tt_select,
--     que também inclui collaborator_id = auth.uid(). companies (companies_select)
--     e listing_validations (lv_select, com o caminho do colaborador responsável)
--     idem. Ou seja: mesmo SEM o filtro explícito abaixo, a RLS já barraria a
--     leitura de listagem de terceiros.
--  2. Filtro explícito `ti.collaborator_id = auth.uid()`: torna a intenção
--     inequívoca e define a semântica de "MINHAS listagens" (as que EU executo),
--     inclusive para admin/consultor que executam via "Meu Trabalho" — cada um
--     só vê o que é seu como executor, nunca o de um colega.
--
-- Não há caminho novo de leitura sem RLS: reaproveita exatamente as policies já
-- existentes (mesmo espírito de listing_validation_queue, do passo 33).
--
-- SÓ o necessário para identificar a listagem: empresa (nome), marca,
-- marketplace, link/justificativa, data e o ESTADO DE VALIDAÇÃO do cliente
-- (derivado do último evento). Nada de tempo, prazo, responsável ou operação.
-- =====================================================================

create or replace function my_listings()
returns table (
  company_id         uuid,
  company_name       text,
  listing_result_id  uuid,
  task_id            uuid,
  task_title         text,
  brand              text,
  marketplace        listing_marketplace,
  link               text,
  not_done_reason    text,
  date               timestamptz,
  validation_event   text,
  validation_by      text,
  validation_comment text,
  validation_at      timestamptz
)
language sql stable security invoker set search_path = public
as $$
  select
    ti.company_id,
    c.name,
    lr.id,
    lr.task_id,
    ti.title,
    lb.name,
    lr.marketplace,
    lr.link,
    lr.not_done_reason,
    coalesce(ti.finished_at, ti.task_date::timestamptz),
    v.event_type,
    v.author_type,
    v.comment,
    v.created_at
  from listing_results lr
  join task_instances ti on ti.id = lr.task_id
  join listing_brands lb on lb.id = lr.brand_id
  join companies      c  on c.id  = ti.company_id
  -- Estado atual = último evento de validação daquela listagem (append-only).
  left join lateral (
    select vv.event_type, vv.author_type, vv.comment, vv.created_at
      from listing_validations vv
     where vv.listing_result_id = lr.id
     order by vv.created_at desc
     limit 1
  ) v on true
  where ti.collaborator_id = auth.uid();
$$;

revoke execute on function my_listings() from public, anon;
grant execute on function my_listings() to authenticated;
