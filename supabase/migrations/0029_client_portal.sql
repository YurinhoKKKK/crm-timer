-- =====================================================================
-- PASSO 25 — Acesso do cliente (portal externo, curado e blindado)
--
-- Mecânica: cada empresa pode ter UM link /cliente/<token> (token aleatório
-- de 24 bytes, não adivinhável) protegido por senha (hash bcrypt). O cliente
-- não tem conta: ao acertar a senha, ganha uma SESSÃO própria (segredo
-- aleatório em cookie HttpOnly; aqui só o hash SHA-256, com validade).
--
-- BLINDAGEM (no banco, não na interface):
--   * O portal só fala com o banco por DUAS funções SECURITY DEFINER
--     (client_portal_login / client_portal_data). A de dados deriva a
--     empresa DA SESSÃO — não recebe company_id — e devolve apenas os
--     campos curados (nome da empresa, listagens COM link e anotações
--     visible_to_client). Por construção, não existe caminho para dados
--     de outra empresa nem para o operacional interno (tarefas, tempo,
--     atrasos, colaboradores).
--   * As tabelas do portal têm RLS: leitura do acesso só para admin /
--     consultor da empresa (para copiar o link); sessões sem policy
--     nenhuma (só as funções tocam nelas). anon não lê nada direto.
--   * Anti força-bruta: 5 senhas erradas travam o link por 15 minutos.
--   * Trocar senha / girar token / revogar derruba as sessões ativas.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Acesso por empresa (um link por empresa)
-- ---------------------------------------------------------------------
create table client_portal_access (
  company_id      uuid primary key references companies(id) on delete cascade,
  token           text not null unique,
  password_hash   text not null,
  active          boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table client_portal_access enable row level security;

-- Admin e o consultor da empresa leem o registro (é como copiam o link).
-- NENHUMA policy de escrita: gravar só pelas funções SECURITY DEFINER.
create policy cpa_select on client_portal_access for select
  using (is_admin() or company_id in (select my_consultant_companies()));

-- ---------------------------------------------------------------------
-- 2. Sessões do cliente (segredo só em hash; validade de 7 dias)
-- ---------------------------------------------------------------------
create table client_portal_sessions (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies(id) on delete cascade,
  secret_hash text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index idx_cps_company on client_portal_sessions(company_id);

-- RLS ligada e SEM policies: ninguém lê/escreve direto (nem admin) —
-- apenas as funções SECURITY DEFINER abaixo.
alter table client_portal_sessions enable row level security;

-- ---------------------------------------------------------------------
-- 3. Gestão (admin / consultor da empresa, autenticados)
-- ---------------------------------------------------------------------

-- Cria o acesso (ou redefine a senha). Mantém o token existente; derruba as
-- sessões ativas (senha nova = todo mundo entra de novo). Retorna o token.
create or replace function client_portal_set(p_company uuid, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if not (is_admin() or p_company in (select my_consultant_companies())) then
    raise exception 'sem permissão para gerenciar o acesso desta empresa';
  end if;
  if length(coalesce(btrim(p_password), '')) < 8 then
    raise exception 'a senha deve ter pelo menos 8 caracteres';
  end if;

  insert into client_portal_access
    (company_id, token, password_hash, active, created_by)
  values
    (p_company, encode(gen_random_bytes(24), 'hex'),
     crypt(p_password, gen_salt('bf')), true, auth.uid())
  on conflict (company_id) do update
    set password_hash   = excluded.password_hash,
        active          = true,
        failed_attempts = 0,
        locked_until    = null,
        updated_at      = now();

  delete from client_portal_sessions where company_id = p_company;

  select token into v_token from client_portal_access
   where company_id = p_company;
  return v_token;
end;
$$;

-- Gira o token (novo link; o antigo morre na hora) e derruba as sessões.
create or replace function client_portal_rotate(p_company uuid)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if not (is_admin() or p_company in (select my_consultant_companies())) then
    raise exception 'sem permissão para gerenciar o acesso desta empresa';
  end if;

  update client_portal_access
     set token = encode(gen_random_bytes(24), 'hex'),
         active = true,
         failed_attempts = 0,
         locked_until = null,
         updated_at = now()
   where company_id = p_company
   returning token into v_token;
  if v_token is null then
    raise exception 'esta empresa ainda não tem acesso de cliente';
  end if;

  delete from client_portal_sessions where company_id = p_company;
  return v_token;
end;
$$;

-- Revoga o acesso: o link para de funcionar e as sessões caem.
create or replace function client_portal_revoke(p_company uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if not (is_admin() or p_company in (select my_consultant_companies())) then
    raise exception 'sem permissão para gerenciar o acesso desta empresa';
  end if;

  update client_portal_access
     set active = false, updated_at = now()
   where company_id = p_company;
  delete from client_portal_sessions where company_id = p_company;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Login do cliente (anon)
-- ---------------------------------------------------------------------
-- result: 'ok' (secret preenchido) | 'locked' | 'invalid'. Token inexistente
-- e senha errada respondem igual ('invalid') — não dá para sondar tokens.
create or replace function client_portal_login(p_token text, p_password text)
returns table (result text, secret text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  a client_portal_access%rowtype;
  v_secret text;
begin
  select * into a from client_portal_access
   where token = p_token and active;

  if not found then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if a.locked_until is not null and a.locked_until > now() then
    return query select 'locked'::text, null::text;
    return;
  end if;

  if a.password_hash = crypt(p_password, a.password_hash) then
    update client_portal_access
       set failed_attempts = 0, locked_until = null
     where company_id = a.company_id;

    v_secret := encode(gen_random_bytes(32), 'hex');
    insert into client_portal_sessions (company_id, secret_hash, expires_at)
    values (a.company_id, encode(digest(v_secret, 'sha256'), 'hex'),
            now() + interval '7 days');

    return query select 'ok'::text, v_secret;
    return;
  end if;

  -- Senha errada: conta a tentativa; na 5ª, trava o link por 15 minutos.
  update client_portal_access
     set failed_attempts = case when failed_attempts + 1 >= 5
                                then 0 else failed_attempts + 1 end,
         locked_until    = case when failed_attempts + 1 >= 5
                                then now() + interval '15 minutes'
                                else locked_until end
   where company_id = a.company_id;

  return query select 'invalid'::text, null::text;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Dados do portal (anon, com sessão válida) — SÓ o conteúdo curado
-- ---------------------------------------------------------------------
-- Recebe token + segredo da sessão e devolve apenas: nome da empresa,
-- listagens ENTREGUES (marca × marketplace COM link — justificativas de
-- não-feitas são internas) e anotações marcadas visible_to_client.
-- Nada de tarefas, tempo, atrasos, colaboradores ou progresso.
create or replace function client_portal_data(p_token text, p_session text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company uuid;
begin
  select s.company_id into v_company
    from client_portal_sessions s
    join client_portal_access a on a.company_id = s.company_id
   where a.token = p_token
     and a.active
     and s.secret_hash = encode(digest(p_session, 'sha256'), 'hex')
     and s.expires_at > now();

  if v_company is null then
    return null;
  end if;

  return jsonb_build_object(
    'company_name', (select name from companies where id = v_company),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'brand', lb.name,
               'marketplace', lr.marketplace,
               'link', lr.link,
               'date', coalesce(ti.finished_at, ti.task_date::timestamptz)
             ) order by coalesce(ti.finished_at, ti.task_date::timestamptz) desc,
                        lb.name)
        from listing_results lr
        join listing_brands lb on lb.id = lr.brand_id
        join task_instances ti on ti.id = lr.task_id
       where ti.company_id = v_company
         and lr.link is not null
    ), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'html', n.content_html,
               'at', n.created_at
             ) order by n.created_at desc)
        from company_notes n
       where n.company_id = v_company
         and n.visible_to_client
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Permissões de execução
-- ---------------------------------------------------------------------
revoke execute on function client_portal_set(uuid, text) from public, anon;
revoke execute on function client_portal_rotate(uuid) from public, anon;
revoke execute on function client_portal_revoke(uuid) from public, anon;
grant execute on function client_portal_set(uuid, text) to authenticated;
grant execute on function client_portal_rotate(uuid) to authenticated;
grant execute on function client_portal_revoke(uuid) to authenticated;

grant execute on function client_portal_login(text, text) to anon, authenticated;
grant execute on function client_portal_data(text, text) to anon, authenticated;
