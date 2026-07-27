-- =====================================================================
-- Ciclo de REAJUSTE das listagens — fecha o loop do passo 33
-- =====================================================================
-- Até aqui só o CLIENTE dava veredito (aprovar / ajuste / contestar). Agora a
-- EQUIPE pode sinalizar que refez o que foi pedido, e o cliente reconfirma.
--
-- Mantém tudo do passo 33: APPEND-ONLY e IMUTÁVEL (sem UPDATE/DELETE), estado =
-- último evento, autoria carimbada no servidor. O novo evento 'reajuste_feito'
-- é sempre INTERNO (author_type='interno', author_id=auth.uid()) — nunca pode se
-- passar por veredito do cliente, e o cliente nunca pode gerá-lo.
--
-- FLUXO: cliente pede ajuste/contesta -> equipe marca 'reajuste_feito' (com
-- comentário opcional) -> a listagem fica AGUARDANDO RECONFIRMAÇÃO do cliente ->
-- cliente APROVA (fecha) ou SOLICITA AJUSTE de novo (reabre e notifica). O loop
-- só fecha na aprovação.
-- =====================================================================

-- 1) Permitir o novo tipo de evento.
alter table listing_validations drop constraint listing_validations_event_type_check;
alter table listing_validations add constraint listing_validations_event_type_check
  check (event_type in ('aprovado', 'ajuste_solicitado', 'contestado', 'reajuste_feito'));

-- 2) Comentário do reajuste é OPCIONAL (como o da aprovação). Ajuste e
--    contestação continuam exigindo comentário.
alter table listing_validations drop constraint lv_comment_required;
alter table listing_validations add constraint lv_comment_required
  check (
    event_type in ('aprovado', 'reajuste_feito')
    or (comment is not null and btrim(comment) <> '')
  );

-- (lv_author_shape já garante que 'interno' tem author_id e nenhum campo de
--  cliente; lv_insert_interno já exige author_type='interno' + author_id=auth.uid()
--  + escopo. Ou seja, o "quem pode marcar" e o "não forja cliente" já estão na RLS.)

-- ---------------------------------------------------------------------
-- 3) Marcar como reajustada (lado interno). SECURITY INVOKER: roda sob a RLS do
-- chamador, então só alcança item no escopo dele (admin / consultor da empresa /
-- colaborador responsável). A COERÊNCIA (só reajustar o que o cliente deixou
-- pendente) é validada aqui no servidor. O INSERT ainda passa por
-- lv_insert_interno (escopo + autoria).
-- ---------------------------------------------------------------------
create or replace function mark_listing_readjusted(
  p_listing_result uuid,
  p_comment        text default null
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_company    uuid;
  v_comment    text := nullif(btrim(coalesce(p_comment, '')), '');
  v_last_event text;
  v_last_by    text;
begin
  -- Empresa do item (sob a RLS do chamador: só enxerga o que é do escopo dele).
  select ti.company_id into v_company
    from listing_results lr
    join task_instances ti on ti.id = lr.task_id
   where lr.id = p_listing_result;
  if v_company is null then
    return jsonb_build_object('ok', false, 'error', 'item');
  end if;

  -- Só faz sentido reajustar o que o CLIENTE deixou pendente (último evento é
  -- um pedido de ajuste ou uma contestação do cliente).
  select v.event_type, v.author_type
    into v_last_event, v_last_by
    from listing_validations v
   where v.listing_result_id = p_listing_result
   order by v.created_at desc
   limit 1;

  if v_last_event is null
     or v_last_by <> 'cliente'
     or v_last_event not in ('ajuste_solicitado', 'contestado') then
    return jsonb_build_object('ok', false, 'error', 'sem_pendencia');
  end if;

  if v_comment is not null and char_length(v_comment) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'longo');
  end if;

  insert into listing_validations
    (listing_result_id, company_id, event_type, comment, author_type, author_id)
  values
    (p_listing_result, v_company, 'reajuste_feito', v_comment, 'interno', auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function mark_listing_readjusted(uuid, text) from public, anon;
grant execute on function mark_listing_readjusted(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Portal: reconfirmação do cliente. Reescreve client_portal_listing_validate
-- (base: migration 0040, com o rate limit 100/10min sem contar aprovações),
-- adicionando o ramo de RECONFIRMAÇÃO: quando o último evento é 'reajuste_feito',
-- o cliente pode APROVAR ou SOLICITAR AJUSTE de novo — independentemente de a
-- listagem ter link ou não (o item pode ter sido contestado e depois atendido).
-- O cliente continua SEM poder enviar 'reajuste_feito' (bloqueado no check 'tipo').
-- ---------------------------------------------------------------------
create or replace function client_portal_listing_validate(
  p_token           text,
  p_session         text,
  p_listing_result  uuid,
  p_event_type      text,
  p_comment         text default null,
  p_ip              text default null,
  p_user_agent      text default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company    uuid := client_portal_session_company(p_token, p_session);
  v_session_id uuid;
  v_has_link   boolean;
  v_last_event text;
  v_comment    text := nullif(btrim(coalesce(p_comment, '')), '');
  v_recent     integer;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'error', 'sessao');
  end if;

  -- O item tem de ser desta empresa. Também descobrimos se é listada (com link).
  select (lr.link is not null) into v_has_link
    from listing_results lr
    join task_instances ti on ti.id = lr.task_id
   where lr.id = p_listing_result and ti.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'item');
  end if;

  -- O cliente só envia veredito de cliente (nunca 'reajuste_feito').
  if p_event_type not in ('aprovado', 'ajuste_solicitado', 'contestado') then
    return jsonb_build_object('ok', false, 'error', 'tipo');
  end if;

  -- Estado atual (último evento) para saber se é uma RECONFIRMAÇÃO.
  select v.event_type into v_last_event
    from listing_validations v
   where v.listing_result_id = p_listing_result
   order by v.created_at desc
   limit 1;

  if v_last_event = 'reajuste_feito' then
    -- Reconfirmação: aprovar (fecha) ou solicitar ajuste (reabre). "Gostaria de
    -- listar" (contestar) não se aplica aqui — o ciclo já é de ajuste.
    if p_event_type = 'contestado' then
      return jsonb_build_object('ok', false, 'error', 'estado');
    end if;
  else
    -- Coerência normal com o estado do item (listada × não listada).
    if p_event_type in ('aprovado', 'ajuste_solicitado') and not v_has_link then
      return jsonb_build_object('ok', false, 'error', 'estado');
    elsif p_event_type = 'contestado' and v_has_link then
      return jsonb_build_object('ok', false, 'error', 'estado');
    end if;
  end if;

  -- Comentário obrigatório para ajuste/contestação.
  if p_event_type in ('ajuste_solicitado', 'contestado') and v_comment is null then
    return jsonb_build_object('ok', false, 'error', 'comentario');
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'longo');
  end if;

  -- Rate limit: 100 por empresa a cada 10 min, sem contar aprovações.
  select count(*) into v_recent
    from listing_validations
   where company_id = v_company
     and author_type = 'cliente'
     and event_type <> 'aprovado'
     and created_at > now() - interval '10 minutes';
  if v_recent >= 100 then
    return jsonb_build_object('ok', false, 'error', 'limite');
  end if;

  select s.id into v_session_id
    from client_portal_sessions s
   where s.company_id = v_company
     and s.secret_hash = encode(digest(p_session, 'sha256'), 'hex');

  insert into listing_validations
    (listing_result_id, company_id, event_type, comment, author_type, author_id,
     client_session_id, client_ip_hash, client_user_agent)
  values
    (p_listing_result, v_company, p_event_type, v_comment,
     'cliente', null,
     v_session_id,
     case when p_ip is null then null
          else encode(digest(p_ip, 'sha256'), 'hex') end,
     left(coalesce(p_user_agent, ''), 400));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function
  client_portal_listing_validate(text, text, uuid, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) my_listings passa a devolver a LINHA DO TEMPO completa (events) por
-- listagem, para a tela do colaborador mostrar cliente pediu -> equipe reajustou
-- (com nome) -> cliente reconfirmou. O escopo continua o mesmo (SECURITY INVOKER
-- + collaborator_id = auth.uid()). Muda o tipo de retorno, então recria.
-- ---------------------------------------------------------------------
drop function if exists my_listings();
create function my_listings()
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
  validation_at      timestamptz,
  events             jsonb
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
    v.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', e.event_type,
               'comment', e.comment,
               'author_type', e.author_type,
               'author', case when e.author_type = 'interno'
                              then split_part(coalesce(dp.name, 'Equipe'), ' ', 1)
                              else null end,
               'at', e.created_at) order by e.created_at)
        from listing_validations e
        left join lateral (
          select name from display_profiles(array[e.author_id]::uuid[])
        ) dp on true
       where e.listing_result_id = lr.id
    ), '[]'::jsonb)
  from listing_results lr
  join task_instances ti on ti.id = lr.task_id
  join listing_brands lb on lb.id = lr.brand_id
  join companies      c  on c.id  = ti.company_id
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
