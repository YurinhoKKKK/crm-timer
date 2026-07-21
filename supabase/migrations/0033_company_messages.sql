-- =====================================================================
-- PASSO 31 — Mensagens cliente ↔ equipe
--
-- É a PRIMEIRA VEZ que o portal do cliente recebe ESCRITA. Até aqui ele só
-- lia, o que simplificava muito a blindagem: bastava garantir que nenhuma
-- consulta saísse do escopo da empresa do token. Agora há um caminho de
-- entrada, e ele precisa do mesmo rigor do passo 25.
--
-- UMA CONVERSA, DUAS JANELAS: o cliente escreve pelo portal (sem conta, pela
-- sessão que já existe); a equipe responde pela central da empresa, com a
-- conta autenticada. Nunca o contrário.
--
-- INTEGRIDADE DE AUTORIA (requisito central): author_type e author_id NUNCA
-- vêm do navegador. São carimbados no SERVIDOR, e por caminhos que não se
-- cruzam:
--   · Portal  -> função SECURITY DEFINER que valida a sessão e escreve
--                author_type='cliente', author_id NULL.
--   · Interno -> INSERT direto, com a policy exigindo author_type='interno'
--                E author_id = auth.uid().
-- Como a policy de INSERT só aceita 'interno', NENHUM usuário autenticado
-- consegue inserir uma linha como se fosse o cliente — nem admin. E como o
-- anon não tem policy nenhuma, o único caminho do cliente é a função.
--
-- MENSAGENS IMUTÁVEIS: não existe policy de UPDATE nem de DELETE, para
-- ninguém. Uma conversa que pode ser reescrita depois não serve de registro.
--
-- TEXTO PURO, sem HTML: além de eliminar a superfície de XSS, mantém a rota
-- do portal leve — nada de DOMPurify/jsdom nesse caminho (passo 29).
-- =====================================================================

create table company_messages (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references companies(id) on delete cascade,
  body         text not null,
  author_type  text not null check (author_type in ('cliente', 'interno')),
  -- Quem respondeu, do lado interno. NULL para o cliente (ele não tem conta).
  author_id    uuid references profiles(id),
  created_at   timestamptz not null default now(),

  -- Proveniência das mensagens do CLIENTE (nunca preenchida no lado interno).
  -- Sem FK para client_portal_sessions de propósito: a sessão é apagada a
  -- cada troca de senha, e a proveniência precisa sobreviver a isso.
  client_session_id uuid,
  client_ip_hash    text,
  client_user_agent text,

  -- A forma da linha reflete o caminho que a criou. Uma linha 'cliente' com
  -- author_id preenchido não é representável.
  constraint cm_author_shape check (
    (author_type = 'interno' and author_id is not null
       and client_session_id is null and client_ip_hash is null)
    or
    (author_type = 'cliente' and author_id is null)
  ),
  constraint cm_body_len check (char_length(btrim(body)) between 1 and 2000)
);

create index idx_cm_company on company_messages(company_id, created_at desc);

alter table company_messages enable row level security;

-- LEITURA: admin, consultor da empresa e colaborador com vínculo (derivado
-- de ter tarefa lá). O cliente NÃO lê por aqui — ele é anon e não alcança a
-- tabela; lê pela função SECURITY DEFINER, escopada à empresa da sessão.
create policy cm_select on company_messages for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

-- ESCRITA INTERNA: só como 'interno' e só em nome de si mesmo. Esta policy é
-- a garantia de que ninguém de dentro forja uma mensagem de cliente — não há
-- WITH CHECK que aceite author_type='cliente'.
create policy cm_insert_interno on company_messages for insert
  with check (
    author_type = 'interno'
    and author_id = auth.uid()
    and (
      is_admin()
      or company_id in (select my_consultant_companies())
      or company_id in (select my_collaborator_companies())
    )
  );

-- Sem policy de UPDATE e sem policy de DELETE: mensagens são imutáveis.

-- ---------------------------------------------------------------------
-- Portal: ler a conversa (anon, com sessão válida)
-- ---------------------------------------------------------------------
-- Devolve a conversa da empresa DA SESSÃO, paginada. Do lado interno mostra
-- só o PRIMEIRO NOME de quem respondeu — é uma conversa, e assinar ajuda a
-- relação; nada de cargo, e-mail ou id. Nenhum dado operacional entra aqui.
create or replace function client_portal_messages(
  p_token   text,
  p_session text,
  p_limit   integer default 30,
  p_offset  integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_company uuid := client_portal_session_company(p_token, p_session);
  v_limit   integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_total   bigint;
  v_items   jsonb;
begin
  if v_company is null then
    return null;
  end if;

  select count(*) into v_total
    from company_messages where company_id = v_company;

  -- Página das mais RECENTES (offset a partir do fim); a tela reordena para
  -- exibir em ordem cronológica.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', page.id,
             'body', page.body,
             'author_type', page.author_type,
             'author', page.author_name,
             'at', page.created_at
           ) order by page.created_at
         ), '[]'::jsonb)
    into v_items
    from (
      select m.id, m.body, m.author_type, m.created_at,
             case when m.author_type = 'interno'
                  then split_part(coalesce(p.full_name, 'Equipe'), ' ', 1)
                  else null end as author_name
        from company_messages m
        left join profiles p on p.id = m.author_id
       where m.company_id = v_company
       order by m.created_at desc
       limit v_limit offset v_offset
    ) page;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

grant execute on function client_portal_messages(text, text, integer, integer)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Portal: enviar mensagem (anon, com sessão válida)
-- ---------------------------------------------------------------------
-- A empresa e o id da sessão vêm DA SESSÃO validada, nunca do payload. O IP
-- chega em claro e é hasheado AQUI (guardar IP de cliente em claro seria
-- coletar mais do que o necessário para a finalidade, que é só distinguir
-- origens em caso de abuso).
--
-- RATE LIMIT (mesmo espírito da trava de senha do passo 25): no máximo 10
-- mensagens por empresa a cada 10 minutos. Devolve erro claro em vez de
-- exceção, para a tela poder explicar o que aconteceu.
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
  if v_recent >= 10 then
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

grant execute on function client_portal_message_send(text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- "Ver como cliente" (passo 30): a conversa também na pré-visualização
-- ---------------------------------------------------------------------
-- Somente LEITURA, como todo o preview: não existe função de envio pelo
-- caminho interno da pré-visualização.
create or replace function client_portal_preview_messages(
  p_company uuid,
  p_limit   integer default 30,
  p_offset  integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
begin
  if not client_portal_can_preview(p_company) then
    raise exception 'sem permissão para pré-visualizar o portal desta empresa';
  end if;

  select count(*) into v_total
    from company_messages where company_id = p_company;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', page.id,
             'body', page.body,
             'author_type', page.author_type,
             'author', page.author_name,
             'at', page.created_at
           ) order by page.created_at
         ), '[]'::jsonb)
    into v_items
    from (
      select m.id, m.body, m.author_type, m.created_at,
             case when m.author_type = 'interno'
                  then split_part(coalesce(p.full_name, 'Equipe'), ' ', 1)
                  else null end as author_name
        from company_messages m
        left join profiles p on p.id = m.author_id
       where m.company_id = p_company
       order by m.created_at desc
       limit v_limit offset v_offset
    ) page;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

revoke execute on function client_portal_preview_messages(uuid, integer, integer)
  from public, anon;
grant execute on function client_portal_preview_messages(uuid, integer, integer)
  to authenticated;
