-- =====================================================================
-- PASSO 30 — Governança do acesso do cliente + "Ver como cliente"
--
-- Pré-requisito do passo 31 (mensagens): se a senha do portal for legível
-- por gente de dentro, qualquer regra de autoria de mensagem é aparência.
--
-- O QUE MUDA:
--   1. GESTÃO SÓ DE ADMIN. Antes, admin OU consultor da empresa gerava/
--      revogava/redefinia. Agora só admin — reforçado no BANCO: a policy de
--      leitura de client_portal_access passa a exigir is_admin(), e as
--      funções de escrita idem. O consultor não obtém token nem hash nem por
--      tela nem por query direta.
--   2. SENHA GERADA PELO SISTEMA E REVELADA UMA ÚNICA VEZ. Antes o admin
--      ESCOLHIA a senha — ou seja, quem criava sabia a senha para sempre.
--      Agora o banco sorteia (16 caracteres, alfabeto sem ambiguidade, ~80
--      bits) e devolve o texto claro UMA vez, na chamada que a gerou. Depois
--      disso não existe caminho de leitura: só o hash bcrypt fica.
--   3. AUDITORIA de toda geração/redefinição/giro/revogação.
--   4. "VER COMO CLIENTE": pré-visualização autenticada, somente leitura,
--      sem token e sem senha, escopada por cargo.
--
-- DECISÃO DE ARQUITETURA (a que mais importa): a CURADORIA do portal é
-- extraída para funções internas de payload, chamadas pelos DOIS caminhos
-- (sessão do cliente e pré-visualização interna). Se fossem consultas
-- duplicadas, um dia divergiriam e o "Ver como cliente" passaria a mentir —
-- mostrando algo que o cliente não vê, ou escondendo algo que ele vê. Com
-- uma definição só, isso é impossível por construção.
--
-- MIGRAÇÃO DAS SENHAS EXISTENTES: mantidas. O hash já era bcrypt (forte), e
-- invalidá-las derrubaria clientes ativos sem ganho real de segurança. O que
-- fica registrado é a PROVENIÊNCIA (password_generated=false = senha do
-- modelo antigo, escolhida por uma pessoa), para a tela sugerir a troca.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Proveniência da senha
-- ---------------------------------------------------------------------
alter table client_portal_access
  add column password_generated boolean not null default false,
  add column password_set_at    timestamptz,
  add column password_set_by    uuid references profiles(id);

comment on column client_portal_access.password_generated is
  'true = senha sorteada pelo sistema e revelada uma única vez; false = senha do modelo antigo, escolhida por uma pessoa (ver passo 30)';

-- As linhas que já existem vieram do modelo antigo: registra o que dá para
-- afirmar com honestidade (quem criou o acesso, quando foi a última escrita).
update client_portal_access
   set password_set_at = updated_at,
       password_set_by = created_by
 where password_set_at is null;

-- ---------------------------------------------------------------------
-- 2. Auditoria
-- ---------------------------------------------------------------------
create table client_portal_audit (
  id         uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  action     text not null check (action in
               ('criado', 'senha_redefinida', 'link_girado', 'revogado')),
  actor_id   uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_cp_audit_company
  on client_portal_audit(company_id, created_at desc);

alter table client_portal_audit enable row level security;

-- Só admin lê. NENHUMA policy de escrita: o histórico só é alimentado pelas
-- funções SECURITY DEFINER abaixo, então ninguém forja nem apaga uma linha.
create policy cp_audit_select on client_portal_audit for select
  using (is_admin());

-- ---------------------------------------------------------------------
-- 3. Gestão passa a ser exclusiva de admin
-- ---------------------------------------------------------------------
-- Antes: is_admin() OR consultor da empresa. O consultor deixa de alcançar
-- token e password_hash por completo — a credencial nunca passa perto dele.
drop policy cpa_select on client_portal_access;

create policy cpa_select on client_portal_access for select
  using (is_admin());

-- ---------------------------------------------------------------------
-- 4. Sorteio da senha
-- ---------------------------------------------------------------------
-- 16 caracteres de um alfabeto de 32 (~80 bits), em grupos de 4 para ser
-- ditável por telefone. Alfabeto sem caracteres ambíguos (i, l, o, 1)
-- justamente porque um humano vai transcrever isso.
create or replace function client_portal_gen_password()
returns text
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz023456789'; -- 32 exatos
  v_bytes bytea := gen_random_bytes(16);
  v_out   text := '';
  i       integer;
begin
  for i in 0..15 loop
    -- 256 é múltiplo de 32, então o módulo não introduz viés.
    v_out := v_out || substr(alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    if i in (3, 7, 11) then
      v_out := v_out || '-';
    end if;
  end loop;
  return v_out;
end;
$$;

revoke execute on function client_portal_gen_password() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Curadoria compartilhada (fonte única do que o cliente enxerga)
-- ---------------------------------------------------------------------
-- Estas funções NÃO autorizam nada: recebem a empresa já resolvida e apenas
-- montam o conteúdo curado. Quem autoriza é o chamador — pela sessão do
-- cliente (token + segredo) ou pelo cargo do usuário logado (preview).
-- Não são executáveis por anon/authenticated: só pelas funções abaixo.

create or replace function client_portal_payload(p_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  return jsonb_build_object(
    'company_name', (select name from companies where id = p_company),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'brand', lb.name,
               'marketplace', lr.marketplace,
               'link', lr.link,
               'reason', lr.not_done_reason,
               'date', coalesce(ti.finished_at, ti.task_date::timestamptz)
             ) order by coalesce(ti.finished_at, ti.task_date::timestamptz) desc,
                        lb.name)
        from listing_results lr
        join listing_brands lb on lb.id = lr.brand_id
        join task_instances ti on ti.id = lr.task_id
       where ti.company_id = p_company
    ), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'html', n.content_html,
               'at', n.created_at
             ) order by n.created_at desc)
        from company_notes n
       where n.company_id = p_company
         and n.visible_to_client
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function client_portal_payload(uuid) from public, anon, authenticated;

create or replace function client_portal_progress_payload(
  p_company uuid,
  p_limit   integer,
  p_offset  integer
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
begin
  select count(*) into v_total
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where ti.company_id = p_company
     and tt.kind = 'unica'
     and tt.template_type = 'padrao'
     and tt.standard_task_id is null
     and ti.status in ('iniciada', 'finalizada')
     and not ti.client_hidden;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title', page.title,
             'state', case when page.status = 'iniciada'
                           then 'em_andamento' else 'entregue' end,
             'done_on', case when page.status = 'finalizada'
                             then to_char(page.finished_at
                                          at time zone 'America/Sao_Paulo',
                                          'YYYY-MM-DD')
                             else null end
           )
           order by page.is_open desc, page.sort_at desc, page.id
         ), '[]'::jsonb)
    into v_items
    from (
      select ti.id, ti.title, ti.status, ti.finished_at,
             (ti.status = 'iniciada') as is_open,
             coalesce(ti.finished_at, ti.created_at) as sort_at
        from task_instances ti
        join task_templates tt on tt.id = ti.template_id
       where ti.company_id = p_company
         and tt.kind = 'unica'
         and tt.template_type = 'padrao'
         and tt.standard_task_id is null
         and ti.status in ('iniciada', 'finalizada')
         and not ti.client_hidden
       order by (ti.status = 'iniciada') desc,
                coalesce(ti.finished_at, ti.created_at) desc,
                ti.id
       limit v_limit offset v_offset
    ) page;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

revoke execute on function client_portal_progress_payload(uuid, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Caminho do CLIENTE (anon, com sessão válida) — agora delegando
-- ---------------------------------------------------------------------
-- A resolução da empresa pela sessão continua idêntica; o que muda é que a
-- curadoria vem da função compartilhada, não de SQL copiado aqui.
create or replace function client_portal_session_company(
  p_token text,
  p_session text
)
returns uuid
language sql stable security definer set search_path = public, extensions
as $$
  select s.company_id
    from client_portal_sessions s
    join client_portal_access a on a.company_id = s.company_id
   where a.token = p_token
     and a.active
     and s.secret_hash = encode(digest(p_session, 'sha256'), 'hex')
     and s.expires_at > now();
$$;

revoke execute on function client_portal_session_company(text, text)
  from public, anon, authenticated;

create or replace function client_portal_data(p_token text, p_session text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company uuid := client_portal_session_company(p_token, p_session);
begin
  if v_company is null then
    return null;
  end if;
  return client_portal_payload(v_company);
end;
$$;

create or replace function client_portal_progress(
  p_token text,
  p_session text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company uuid := client_portal_session_company(p_token, p_session);
begin
  if v_company is null then
    return null;
  end if;
  return client_portal_progress_payload(v_company, p_limit, p_offset);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. "Ver como cliente" — pré-visualização autenticada, somente leitura
-- ---------------------------------------------------------------------
-- Autoriza pelo CARGO do usuário logado (admin em todas; consultor só nas
-- dele) e chama a MESMA curadoria do portal. Não recebe nem devolve token,
-- não toca client_portal_access e não cria sessão de portal: um consultor
-- pode ver o que o cliente vê sem nunca alcançar a credencial.
create or replace function client_portal_can_preview(p_company uuid)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select auth.uid() is not null
     and (is_admin() or p_company in (select my_consultant_companies()));
$$;

grant execute on function client_portal_can_preview(uuid) to authenticated;

create or replace function client_portal_preview(p_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not client_portal_can_preview(p_company) then
    raise exception 'sem permissão para pré-visualizar o portal desta empresa';
  end if;
  return client_portal_payload(p_company);
end;
$$;

create or replace function client_portal_preview_progress(
  p_company uuid,
  p_limit   integer default 20,
  p_offset  integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not client_portal_can_preview(p_company) then
    raise exception 'sem permissão para pré-visualizar o portal desta empresa';
  end if;
  return client_portal_progress_payload(p_company, p_limit, p_offset);
end;
$$;

revoke execute on function client_portal_preview(uuid) from public, anon;
revoke execute on function client_portal_preview_progress(uuid, integer, integer)
  from public, anon;
grant execute on function client_portal_preview(uuid) to authenticated;
grant execute on function client_portal_preview_progress(uuid, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------
-- 8. Estado do acesso para o CONSULTOR (sem credencial nenhuma)
-- ---------------------------------------------------------------------
-- O consultor precisa saber se aquele cliente já tem portal para conduzir a
-- relação, mas não pode alcançar token nem hash. Esta função devolve
-- SOMENTE dois booleanos.
create or replace function client_portal_status(p_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_active boolean;
begin
  if not client_portal_can_preview(p_company) then
    raise exception 'sem permissão para consultar o acesso desta empresa';
  end if;

  select active into v_active
    from client_portal_access where company_id = p_company;

  return jsonb_build_object(
    'exists', v_active is not null,
    'active', coalesce(v_active, false)
  );
end;
$$;

revoke execute on function client_portal_status(uuid) from public, anon;
grant execute on function client_portal_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Escrita: exclusiva de admin, com senha sorteada e auditoria
-- ---------------------------------------------------------------------
-- A assinatura antiga recebia a senha em claro escolhida pelo admin. Some,
-- para não sobrar caminho pelo modelo velho.
drop function if exists client_portal_set(uuid, text);

-- Cria o acesso ou redefine a senha. Devolve { token, password } — é a
-- ÚNICA vez que a senha em claro existe fora da cabeça de quem a recebe.
create or replace function client_portal_set(p_company uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_password text := client_portal_gen_password();
  v_token    text;
  v_existed  boolean;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if not is_admin() then
    raise exception 'apenas administradores gerenciam o acesso do cliente';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'empresa inexistente';
  end if;

  select true into v_existed
    from client_portal_access where company_id = p_company;

  insert into client_portal_access
    (company_id, token, password_hash, active, created_by,
     password_generated, password_set_at, password_set_by)
  values
    (p_company, encode(gen_random_bytes(24), 'hex'),
     crypt(v_password, gen_salt('bf')), true, auth.uid(),
     true, now(), auth.uid())
  on conflict (company_id) do update
    set password_hash      = excluded.password_hash,
        active             = true,
        failed_attempts    = 0,
        locked_until       = null,
        password_generated = true,
        password_set_at    = now(),
        password_set_by    = auth.uid(),
        updated_at         = now();

  -- Senha nova = todo mundo entra de novo.
  delete from client_portal_sessions where company_id = p_company;

  insert into client_portal_audit (company_id, action, actor_id)
  values (p_company,
          case when coalesce(v_existed, false)
               then 'senha_redefinida' else 'criado' end,
          auth.uid());

  select token into v_token from client_portal_access
   where company_id = p_company;

  return jsonb_build_object('token', v_token, 'password', v_password);
end;
$$;

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
  if not is_admin() then
    raise exception 'apenas administradores gerenciam o acesso do cliente';
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

  insert into client_portal_audit (company_id, action, actor_id)
  values (p_company, 'link_girado', auth.uid());

  return v_token;
end;
$$;

create or replace function client_portal_revoke(p_company uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if not is_admin() then
    raise exception 'apenas administradores gerenciam o acesso do cliente';
  end if;
  if not exists (select 1 from client_portal_access where company_id = p_company) then
    raise exception 'esta empresa ainda não tem acesso de cliente';
  end if;

  update client_portal_access
     set active = false, updated_at = now()
   where company_id = p_company;
  delete from client_portal_sessions where company_id = p_company;

  insert into client_portal_audit (company_id, action, actor_id)
  values (p_company, 'revogado', auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Tela de gestão do admin: estado + histórico numa ida só
-- ---------------------------------------------------------------------
-- Uma chamada em vez de duas (disciplina do passo 29: o custo é número de
-- idas × latência). SECURITY DEFINER para resolver os NOMES de quem agiu
-- sem depender de profiles_select. NUNCA devolve password_hash — não existe
-- caminho de leitura da senha, nem para admin.
create or replace function client_portal_admin_view(p_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'apenas administradores veem o acesso do cliente';
  end if;

  return jsonb_build_object(
    'access', (
      select jsonb_build_object(
               'token', a.token,
               'active', a.active,
               'createdAt', a.created_at,
               'updatedAt', a.updated_at,
               'passwordGenerated', a.password_generated,
               'passwordSetAt', a.password_set_at,
               'createdBy', coalesce(pc.full_name, pc.email),
               'passwordSetBy', coalesce(ps.full_name, ps.email)
             )
        from client_portal_access a
        left join profiles pc on pc.id = a.created_by
        left join profiles ps on ps.id = a.password_set_by
       where a.company_id = p_company
    ),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'action', a.action,
               'actor', coalesce(p.full_name, p.email, 'usuário removido'),
               'at', a.created_at
             ) order by a.created_at desc)
        from client_portal_audit a
        left join profiles p on p.id = a.actor_id
       where a.company_id = p_company
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function client_portal_admin_view(uuid) from public, anon;
grant execute on function client_portal_admin_view(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Permissões das funções de escrita (inalteradas na forma: quem barra
--     de fato é o is_admin() lá dentro, não o GRANT)
-- ---------------------------------------------------------------------
revoke execute on function client_portal_set(uuid) from public, anon;
grant execute on function client_portal_set(uuid) to authenticated;
