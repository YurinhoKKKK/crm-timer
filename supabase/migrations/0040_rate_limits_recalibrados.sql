-- =====================================================================
-- Recalibração dos rate limits do portal (passos 31 e 33)
-- =====================================================================
-- O teto de 20 validações/10min era baixo demais: uma empresa já tem 23 itens
-- de listagem, então um cliente revisando tudo de uma vez travaria no 20º, no
-- meio da tarefa. O objetivo do limite é barrar FLOOD automatizado, não uso
-- legítimo.
--
-- Mudanças:
--  · Validações: teto 20 -> 100 por empresa a cada 10 min, e APROVAÇÕES não
--    contam (é um clique sem texto e sem custo; o vetor de abuso é comentário).
--  · Mensagens (passo 31): mesmo risco em menor grau — um cliente animado numa
--    conversa passa de 10 mensagens/10min. Teto 10 -> 30.
-- =====================================================================

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
  v_comment    text := nullif(btrim(coalesce(p_comment, '')), '');
  v_recent     integer;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'error', 'sessao');
  end if;

  select (lr.link is not null) into v_has_link
    from listing_results lr
    join task_instances ti on ti.id = lr.task_id
   where lr.id = p_listing_result and ti.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'item');
  end if;

  if p_event_type in ('aprovado', 'ajuste_solicitado') and not v_has_link then
    return jsonb_build_object('ok', false, 'error', 'estado');
  elsif p_event_type = 'contestado' and v_has_link then
    return jsonb_build_object('ok', false, 'error', 'estado');
  elsif p_event_type not in ('aprovado', 'ajuste_solicitado', 'contestado') then
    return jsonb_build_object('ok', false, 'error', 'tipo');
  end if;

  if p_event_type in ('ajuste_solicitado', 'contestado') and v_comment is null then
    return jsonb_build_object('ok', false, 'error', 'comentario');
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'longo');
  end if;

  -- Rate limit anti-flood: 100 por empresa a cada 10 min, sem contar aprovações
  -- (clique sem texto). Folga larga para o cliente revisar uma lista inteira.
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

-- Mensagens (passo 31): teto 10 -> 30 por empresa a cada 10 min.
create or replace function client_portal_message_send(
  p_token      text,
  p_session    text,
  p_body       text,
  p_ip         text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company    uuid := client_portal_session_company(p_token, p_session);
  v_session_id uuid;
  v_body       text := btrim(coalesce(p_body, ''));
  v_recent     integer;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'error', 'sessao');
  end if;

  if char_length(v_body) = 0 then
    return jsonb_build_object('ok', false, 'error', 'vazia');
  end if;
  if char_length(v_body) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'longa');
  end if;

  select count(*) into v_recent
    from company_messages
   where company_id = v_company
     and author_type = 'cliente'
     and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    return jsonb_build_object('ok', false, 'error', 'limite');
  end if;

  select s.id into v_session_id
    from client_portal_sessions s
   where s.company_id = v_company
     and s.secret_hash = encode(digest(p_session, 'sha256'), 'hex');

  insert into company_messages
    (company_id, body, author_type, author_id,
     client_session_id, client_ip_hash, client_user_agent)
  values
    (v_company, v_body, 'cliente', null,
     v_session_id,
     case when p_ip is null then null
          else encode(digest(p_ip, 'sha256'), 'hex') end,
     left(coalesce(p_user_agent, ''), 400));

  return jsonb_build_object('ok', true);
end;
$$;
