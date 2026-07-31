-- =====================================================================
-- INTEGRAÇÃO GOOGLE CALENDAR — ETAPA 1 (só ESCRITA, OAuth por usuário)
--
-- O sistema é a FONTE DA VERDADE da reunião; o Google é destino/cópia. Nesta
-- etapa o sistema só ESCREVE (cria evento na agenda primária do próprio
-- colaborador). Escopo pedido: .../auth/calendar.events.owned.
--
-- ATENÇÃO — ESCOPO NÃO É GARANTIA DE "NÃO LÊ AGENDA": calendar.events.owned
-- concede TAMBÉM LEITURA dos eventos criados por esta conta/aplicação. Ou seja,
-- o Google PERMITE ler; que o sistema não leia agenda é DISCIPLINA NOSSA, não um
-- limite do escopo. Nesta etapa NÃO existe nenhum código que leia agenda — e
-- este arquivo não cria nada que o faça.
--
-- RIGOR DOS TOKENS = o da senha do portal (passo 30), com uma diferença: senha
-- é HASH (irreversível, só se confere); token de OAuth precisa ser DECIFRÁVEL
-- para chamar o Google. Então em vez de bcrypt, cifra simétrica (pgp_sym_*),
-- com a chave guardada no Supabase Vault — nunca em texto no código nem no git.
--
-- GARANTIAS (as que mais importam):
--   1. NÃO EXISTE service_role neste sistema. O token em claro só nasce DENTRO
--      de funções SECURITY DEFINER que descobrem o dono por auth.uid() e leem
--      só a PRÓPRIA linha — chamadas pelo servidor com a MESMA sessão do usuário
--      (cliente anon+cookie do resto do app). Mesmo invocando o RPC direto do
--      navegador, ninguém alcança o token de outra pessoa; e nenhuma chave que
--      atropela o RLS global entra no projeto.
--   2. As colunas de token NÃO têm GRANT para o navegador: um select comum
--      devolve só metadados (e-mail conectado, validade, escopo). O ciphertext
--      nunca sai por PostgREST.
--   3. RLS: cada usuário alcança só a PRÓPRIA linha. NENHUMA política dá a admin
--      o token de outro (contraste com o passo 30, onde admin gere o portal —
--      aqui o token é pessoal e ninguém mais o toca).
--   4. Auditoria de conexão/desconexão/revogação, alimentada só por função.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Chave de cifra no Vault — gerada AQUI, aleatória, uma única vez
-- ---------------------------------------------------------------------
-- O valor da chave nunca aparece neste arquivo: é sorteado no apply e fica só
-- no Vault (cifrado pela chave-mestra do projeto). O guard tolera re-execução.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'google_token_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'google_token_key',
      'Chave simétrica de cifra dos tokens do Google Calendar (etapa 1)'
    );
  end if;
end $$;

-- Leitura da chave: helper interno, SECURITY DEFINER. Não é executável por
-- ninguém de fora — as funções abaixo o chamam já rodando como dono.
create or replace function google_enc_key()
returns text
language sql stable security definer set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'google_token_key' limit 1;
$$;

revoke execute on function google_enc_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Conta Google conectada (1 por usuário)
-- ---------------------------------------------------------------------
create table google_accounts (
  user_id            uuid primary key references profiles(id) on delete cascade,
  google_email       text not null,            -- qual conta Google foi conectada
  access_token_enc   bytea not null,           -- pgp_sym_encrypt(access_token, chave)
  refresh_token_enc  bytea,                     -- pode faltar num reconsentimento sem novo refresh
  token_expiry       timestamptz not null,      -- quando o access_token vence
  scope              text not null,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table google_accounts is
  'Tokens OAuth do Google por usuário, CIFRADOS. Nunca legível pelo navegador; decifra só em funções SECURITY DEFINER que filtram por auth.uid(). Sem service_role.';

alter table google_accounts enable row level security;

-- RLS: cada um vê só a PRÓPRIA linha. Sem cláusula is_admin() — de propósito:
-- token é pessoal, admin não lê o de ninguém.
create policy ga_select_own on google_accounts for select
  using (user_id = auth.uid());

-- Nenhuma policy de insert/update/delete: a escrita passa só pelas funções
-- SECURITY DEFINER abaixo (com a sessão do próprio usuário). O navegador não
-- escreve aqui diretamente.

-- Privilégio de COLUNA: o role autenticado (navegador) enxerga só metadados.
-- Mesmo com a linha visível por RLS, as colunas de token ficam fora do GRANT,
-- então um select do cliente jamais devolve o ciphertext.
revoke select on google_accounts from authenticated;
grant  select (user_id, google_email, token_expiry, scope, connected_at, updated_at)
  on google_accounts to authenticated;

-- ---------------------------------------------------------------------
-- 2. Auditoria de conexão
-- ---------------------------------------------------------------------
create table google_calendar_audit (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  action     text not null check (action in
               ('conectado', 'desconectado', 'revogado', 'erro_revogacao')),
  detail     text,
  created_at timestamptz not null default now()
);

create index idx_gcal_audit_user on google_calendar_audit(user_id, created_at desc);

alter table google_calendar_audit enable row level security;

-- Dono vê o próprio histórico; admin vê tudo (para auditar a frente inteira).
-- Escrita só por função (nenhuma policy de insert) — ninguém forja uma linha.
create policy gcal_audit_select on google_calendar_audit for select
  using (user_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- 3. Funções de token — a ÚNICA porta para o texto claro
-- ---------------------------------------------------------------------
-- Todas SECURITY DEFINER. NÃO recebem p_user e NÃO usam service_role: cada uma
-- descobre o dono por auth.uid() e só toca a própria linha. O servidor as chama
-- com o MESMO cliente anon+cookie do resto do app (a sessão do usuário). Se
-- auth.uid() for nulo (chamada sem sessão), a função recusa.

-- Grava/atualiza a conexão do PRÓPRIO usuário e audita 'conectado'. Preserva o
-- refresh antigo se o Google não devolver um novo (comum em reconsentimentos).
create or replace function google_upsert_account(
  p_email text, p_access text, p_refresh text,
  p_expiry timestamptz, p_scope text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, vault
as $$
declare
  v_user uuid := auth.uid();
  v_key  text;
begin
  if v_user is null then
    raise exception 'google_upsert_account: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  v_key := google_enc_key();

  insert into google_accounts as g
    (user_id, google_email, access_token_enc, refresh_token_enc,
     token_expiry, scope, connected_at, updated_at)
  values
    (v_user, p_email,
     extensions.pgp_sym_encrypt(p_access, v_key),
     case when p_refresh is null then null
          else extensions.pgp_sym_encrypt(p_refresh, v_key) end,
     p_expiry, p_scope, now(), now())
  on conflict (user_id) do update set
     google_email      = excluded.google_email,
     access_token_enc  = excluded.access_token_enc,
     refresh_token_enc = coalesce(excluded.refresh_token_enc, g.refresh_token_enc),
     token_expiry      = excluded.token_expiry,
     scope             = excluded.scope,
     updated_at        = now();

  insert into google_calendar_audit(user_id, action) values (v_user, 'conectado');
end;
$$;

-- Devolve o token em claro do PRÓPRIO chamador para o servidor usar. É a razão
-- de a decifra existir. Nunca recebe id de outro; auth.uid() é o filtro.
create or replace function google_get_account()
returns table(google_email text, access_token text, refresh_token text,
              token_expiry timestamptz, scope text)
language plpgsql stable security definer
set search_path = public, extensions, vault
as $$
declare
  v_user uuid := auth.uid();
  v_key  text;
begin
  if v_user is null then
    raise exception 'google_get_account: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  v_key := google_enc_key();

  return query
  select g.google_email,
         extensions.pgp_sym_decrypt(g.access_token_enc, v_key),
         case when g.refresh_token_enc is null then null
              else extensions.pgp_sym_decrypt(g.refresh_token_enc, v_key) end,
         g.token_expiry, g.scope
  from google_accounts g where g.user_id = v_user;
end;
$$;

-- Após renovar o access_token pelo refresh: regrava só o access e a validade do
-- PRÓPRIO usuário.
create or replace function google_update_access(
  p_access text, p_expiry timestamptz)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, vault
as $$
declare
  v_user uuid := auth.uid();
  v_key  text;
begin
  if v_user is null then
    raise exception 'google_update_access: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  v_key := google_enc_key();

  update google_accounts
     set access_token_enc = extensions.pgp_sym_encrypt(p_access, v_key),
         token_expiry     = p_expiry,
         updated_at       = now()
   where user_id = v_user;
end;
$$;

-- Desconecta o PRÓPRIO usuário: apaga a linha. `p_revoked` distingue "revogado
-- no Google com sucesso" de uma desconexão comum; a auditoria fica com o
-- registro certo.
create or replace function google_delete_account(p_revoked boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'google_delete_account: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  delete from google_accounts where user_id = v_user;
  insert into google_calendar_audit(user_id, action)
  values (v_user, case when p_revoked then 'revogado' else 'desconectado' end);
end;
$$;

-- Registro avulso de auditoria do PRÓPRIO usuário (ex.: a revogação no Google
-- falhou mas apagamos o token local mesmo assim — fica a trilha
-- 'erro_revogacao'). O action é limitado pelo check da tabela.
create or replace function google_audit(p_action text, p_detail text default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'google_audit: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  insert into google_calendar_audit(user_id, action, detail)
  values (v_user, p_action, p_detail);
end;
$$;

-- Executável pelo usuário logado (authenticated), NÃO por anon. Sem service_role.
-- Cada função já se protege por auth.uid() por dentro: mesmo chamada do
-- navegador, ninguém alcança dado de outro.
revoke execute on function google_upsert_account(text, text, text, timestamptz, text) from public, anon;
revoke execute on function google_get_account()                     from public, anon;
revoke execute on function google_update_access(text, timestamptz)  from public, anon;
revoke execute on function google_delete_account(boolean)           from public, anon;
revoke execute on function google_audit(text, text)                 from public, anon;

grant execute on function google_upsert_account(text, text, text, timestamptz, text) to authenticated;
grant execute on function google_get_account()                     to authenticated;
grant execute on function google_update_access(text, timestamptz)  to authenticated;
grant execute on function google_delete_account(boolean)           to authenticated;
grant execute on function google_audit(text, text)                 to authenticated;

-- ---------------------------------------------------------------------
-- 4. Reuniões — o sistema é a fonte da verdade
-- ---------------------------------------------------------------------
-- company_id é OBRIGATÓRIO: é o vínculo que, na próxima etapa, deixa o portal
-- do cliente saber de quem é a reunião sem adivinhar. google_* podem ficar
-- nulos (reunião criada sem conexão ou com falha no Google) — nunca se perde a
-- reunião por causa da integração.
create table meetings (
  id                 uuid primary key default uuid_generate_v4(),
  company_id         uuid not null references companies(id) on delete cascade,
  title              text not null,
  description        text,
  starts_at          timestamptz not null,   -- guardado em UTC; a UI usa fuso de Brasília
  ends_at            timestamptz not null,
  meeting_type       text not null default 'meet'
                       check (meeting_type in ('meet', 'presencial_escritorio', 'presencial_cliente')),
  created_by         uuid not null references profiles(id),
  google_event_id    text,                    -- id do evento no Google (null se não foi)
  google_calendar_id text,                    -- normalmente 'primary' do criador
  meet_link          text,                    -- link do Meet quando tipo = meet
  google_sync_status text not null default 'pendente'
                       check (google_sync_status in
                         ('pendente', 'sincronizado', 'nao_conectado', 'falhou')),
  google_sync_error  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index idx_meetings_company on meetings(company_id, starts_at desc);
create index idx_meetings_creator on meetings(created_by, starts_at desc);

create table meeting_participants (
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  primary key (meeting_id, user_id)
);

create index idx_meeting_participants_user on meeting_participants(user_id);

alter table meetings             enable row level security;
alter table meeting_participants enable row level security;

-- Quem enxerga uma reunião: admin tudo; consultor as das SUAS empresas; quem
-- criou; e quem foi convidado como participante.
create policy meetings_select on meetings for select
  using (
    is_admin()
    or created_by = auth.uid()
    or company_id in (select my_consultant_companies())
    or exists (select 1 from meeting_participants mp
                where mp.meeting_id = meetings.id and mp.user_id = auth.uid())
  );

-- Criar: o criador é sempre auth.uid(), e só para empresa que ele alcança
-- (admin qualquer; consultor a sua; colaborador uma em que atua).
create policy meetings_insert on meetings for insert
  with check (
    created_by = auth.uid()
    and (
      is_admin()
      or company_id in (select my_consultant_companies())
      or company_id in (select my_collaborator_companies())
    )
  );

-- Atualizar (guardar event_id/meet_link/status após falar com o Google): só o
-- criador ou admin. Edição/cancelamento sincronizado fica para depois.
create policy meetings_update on meetings for update
  using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

-- Participantes: visíveis a quem vê a reunião; escrita só do criador/admin.
create policy mp_select on meeting_participants for select
  using (exists (select 1 from meetings m where m.id = meeting_id));

create policy mp_write on meeting_participants for all
  using (exists (select 1 from meetings m
                  where m.id = meeting_id and (m.created_by = auth.uid() or is_admin())))
  with check (exists (select 1 from meetings m
                  where m.id = meeting_id and (m.created_by = auth.uid() or is_admin())));

comment on table meetings is
  'Reuniões (etapa 1 Google Calendar). Fonte da verdade no sistema; espelhada na agenda Google do criador quando ele conectou a conta.';
