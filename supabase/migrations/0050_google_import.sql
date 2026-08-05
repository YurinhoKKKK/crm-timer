-- =====================================================================
-- REUNIÕES — FATIA 2: IMPORTAR a agenda do Google para dentro do sistema
--
-- Objetivo: a agenda interna deixa de ser "meia" e a detecção de conflito passa
-- a ser REAL. Importamos os eventos que a conta do PRÓPRIO usuário tem no Google
-- (agenda primária) — passado recente + futuro próximo — para exibi-los na grade
-- (com aparência distinta, somente-leitura) e considerá-los no aviso de conflito.
--
-- ESCOPO já concedido (0043): calendar.events.owned PERMITE LEITURA dos eventos
-- da conta. Ninguém reconecta nem amplia permissão. Continuamos SEM service_role:
-- o token em claro só nasce dentro de google_get_account() (0043), que o descobre
-- por auth.uid() e só devolve a PRÓPRIA linha. Logo o servidor só consegue ler a
-- agenda de QUEM ESTÁ LOGADO — nunca a de outro. As funções de ESCRITA abaixo
-- fecham o círculo: derivam o dono por auth.uid() e NUNCA recebem p_user, então
-- mesmo chamadas direto do navegador ninguém grava evento no nome alheio.
--
-- PRIVACIDADE (decisão de produto): títulos são visíveis a todos os internos,
-- inclusive em convites de terceiros — coerente com a visibilidade total do
-- módulo (0046). ÚNICA exceção: evento marcado como PARTICULAR no Google
-- (visibility private/confidential) não expõe o título aos colegas — para eles
-- vira "Ocupado". O DONO vê normalmente. A curadoria mora nas funções de leitura
-- (nunca no cliente): o título particular de outro NÃO sai do banco.
--
-- SOMENTE LEITURA: eventos importados são um ESPELHO. Sem empresa, sem
-- participantes internos, sem portal do cliente, sem editar/excluir pelo sistema.
-- O portal do cliente NÃO é afetado: nenhuma função de portal (0031/0049) toca
-- esta tabela — o cliente (anon) jamais vê um evento importado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Espelho dos eventos importados
-- ---------------------------------------------------------------------
create table imported_google_events (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null references profiles(id) on delete cascade,
  google_calendar_id text not null default 'primary',
  google_event_id    text not null,
  title              text,                    -- summary; pode faltar (evento sem título)
  starts_at          timestamptz not null,    -- só eventos COM horário (all-day fora desta fatia)
  ends_at            timestamptz not null,
  is_private         boolean not null default false, -- visibility private/confidential no Google
  updated_at         timestamptz not null default now(),
  unique (user_id, google_calendar_id, google_event_id),
  check (ends_at > starts_at)
);

comment on table imported_google_events is
  'Espelho SOMENTE-LEITURA dos eventos da agenda Google do próprio usuário (Fatia 2). Escrito só por funções SECURITY DEFINER que derivam o dono por auth.uid(). Título particular de outro nunca sai do banco (curado nas funções de leitura). Nunca chega ao portal do cliente.';

create index idx_imported_events_user_time on imported_google_events(user_id, starts_at);
create index idx_imported_events_time on imported_google_events(starts_at, ends_at);

alter table imported_google_events enable row level security;

-- Leitura direta (PostgREST): SÓ o próprio dono, com título íntegro. A leitura
-- CRUZADA (grade do calendário, onde entra a curadoria de privacidade) passa pela
-- função imported_events_range() abaixo — nunca por select direto de outro. Assim
-- o título particular de um colega não vaza nem por query manual.
create policy ige_select_own on imported_google_events for select
  using (user_id = auth.uid());

-- Sem policy de insert/update/delete: a escrita passa só pelas funções DEFINER
-- (com a sessão do próprio usuário). O navegador não escreve aqui diretamente.

-- ---------------------------------------------------------------------
-- 2. Estado da sincronização (por usuário)
-- ---------------------------------------------------------------------
-- Guarda o syncToken (para sync incremental), a janela já coberta e os carimbos
-- de tempo (para "sincronizado há X" e para decidir re-ancorar a janela rolante).
create table google_calendar_import_state (
  user_id           uuid primary key references profiles(id) on delete cascade,
  sync_token        text,             -- nextSyncToken do Google (null = precisa full sync)
  window_start      timestamptz,      -- janela coberta pelo último full sync
  window_end        timestamptz,
  last_full_sync_at timestamptz,      -- quando foi o último full (re-ancora a janela)
  last_synced_at    timestamptz,      -- qualquer sync (full ou incremental)
  updated_at        timestamptz not null default now()
);

alter table google_calendar_import_state enable row level security;

-- O dono lê o próprio estado (a /agenda mostra "sincronizado há X"). Escrita só
-- por função. Ninguém lê o estado alheio — token de sync é dado pessoal.
create policy gcis_select_own on google_calendar_import_state for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Leitura CURADA para a grade (todos os internos, com privacidade)
-- ---------------------------------------------------------------------
-- Devolve os eventos importados de TODOS os usuários que tocam a janela, para a
-- grade cruzar agendas. Curadoria: título de evento PARTICULAR de OUTRO vira null
-- (o cliente exibe "Ocupado"); o dono vê o próprio título. Nunca devolve nada a
-- anon (auth.uid() nulo => zero linhas), então o portal do cliente fica de fora.
create or replace function imported_events_range(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  id         uuid,
  owner_id   uuid,
  title      text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_private boolean
)
language sql stable security definer set search_path = public
as $$
  select e.id,
         e.user_id,
         case when e.is_private and e.user_id <> auth.uid() then null
              else e.title end,
         e.starts_at,
         e.ends_at,
         e.is_private
  from imported_google_events e
  where auth.uid() is not null
    and e.starts_at < p_to
    and e.ends_at   > p_from
  order by e.starts_at;
$$;

revoke execute on function imported_events_range(timestamptz, timestamptz) from public, anon;
grant  execute on function imported_events_range(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Conflito de horário incluindo os importados — AVISO, nunca bloqueio
-- ---------------------------------------------------------------------
-- Substitui, na prática, o uso de meeting_conflicts (0046): une reuniões DO
-- SISTEMA e eventos IMPORTADOS que se sobrepõem à janela e envolvem algum dos
-- usuários consultados (criador OU participante das reuniões; dono dos
-- importados). `source` distingue 'sistema' de 'google'. Título curado igual à
-- grade (particular de outro => null => a tela mostra "Ocupado"). p_exclude só
-- se aplica às reuniões do sistema (importado não tem id de reunião).
create or replace function schedule_conflicts(
  p_starts    timestamptz,
  p_ends      timestamptz,
  p_user_ids  uuid[],
  p_exclude   uuid default null
)
returns table (
  source               text,
  ref_id               uuid,
  title                text,
  starts_at            timestamptz,
  ends_at              timestamptz,
  company_name         text,
  conflicting_user_ids uuid[]
)
language sql stable security definer set search_path = public
as $$
  -- Reuniões do sistema (mesma lógica de meeting_conflicts)
  select 'sistema'::text, m.id, m.title, m.starts_at, m.ends_at, c.name,
         array_agg(distinct cu.uid order by cu.uid)
  from meetings m
  join companies c on c.id = m.company_id
  join lateral (
    select u.uid
    from unnest(p_user_ids) as u(uid)
    where m.created_by = u.uid
       or exists (select 1 from meeting_participants mp
                   where mp.meeting_id = m.id and mp.user_id = u.uid)
  ) cu on true
  where m.starts_at < p_ends
    and m.ends_at   > p_starts
    and (p_exclude is null or m.id <> p_exclude)
  group by m.id, m.title, m.starts_at, m.ends_at, c.name

  union all

  -- Eventos importados do Google (um dono cada). Título particular de OUTRO vira
  -- null; company_name é sempre null (importado não tem empresa).
  select 'google'::text, e.id,
         case when e.is_private and e.user_id <> auth.uid() then null else e.title end,
         e.starts_at, e.ends_at, null::text,
         array[e.user_id]
  from imported_google_events e
  where e.user_id = any(p_user_ids)
    and e.starts_at < p_ends
    and e.ends_at   > p_starts

  order by 4;  -- starts_at
$$;

revoke execute on function schedule_conflicts(timestamptz, timestamptz, uuid[], uuid) from public, anon;
grant  execute on function schedule_conflicts(timestamptz, timestamptz, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. ESCRITA — full replace (a ÚNICA porta, deriva o dono por auth.uid())
-- ---------------------------------------------------------------------
-- Sync COMPLETO: troca todo o espelho do PRÓPRIO usuário pela janela recém-lida.
-- Não recebe p_user — o dono é sempre auth.uid(). Assim ninguém, nem chamando o
-- RPC direto, grava evento no nome de outra pessoa. p_events é o array já
-- filtrado no servidor (sem all-day, sem recusados, sem os criados pelo sistema).
create or replace function google_import_replace(
  p_events       jsonb,
  p_window_start timestamptz,
  p_window_end   timestamptz,
  p_sync_token   text
)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'google_import_replace: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;

  delete from imported_google_events where user_id = v_user;

  insert into imported_google_events
    (user_id, google_calendar_id, google_event_id, title, starts_at, ends_at, is_private)
  select v_user, x.calendar_id, x.event_id, x.title, x.starts_at, x.ends_at, coalesce(x.is_private, false)
  from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as x(
    calendar_id text, event_id text, title text,
    starts_at timestamptz, ends_at timestamptz, is_private boolean
  )
  on conflict (user_id, google_calendar_id, google_event_id) do nothing;

  insert into google_calendar_import_state
    (user_id, sync_token, window_start, window_end, last_full_sync_at, last_synced_at, updated_at)
  values (v_user, p_sync_token, p_window_start, p_window_end, now(), now(), now())
  on conflict (user_id) do update set
    sync_token        = excluded.sync_token,
    window_start      = excluded.window_start,
    window_end        = excluded.window_end,
    last_full_sync_at = excluded.last_full_sync_at,
    last_synced_at    = excluded.last_synced_at,
    updated_at        = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 6. ESCRITA — incremental (upserts + remoções vindas do syncToken)
-- ---------------------------------------------------------------------
-- Sync INCREMENTAL: aplica só o que mudou desde o último syncToken. p_upserts são
-- eventos novos/alterados; p_deletes são os google_event_id cancelados/saídos.
-- Mesma blindagem: dono = auth.uid(); nunca recebe p_user. NÃO mexe na janela nem
-- no last_full_sync_at (só o full os re-ancora).
create or replace function google_import_apply(
  p_upserts    jsonb,
  p_deletes    text[],
  p_sync_token text
)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'google_import_apply: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;

  if p_deletes is not null and array_length(p_deletes, 1) is not null then
    delete from imported_google_events
     where user_id = v_user and google_event_id = any(p_deletes);
  end if;

  insert into imported_google_events
    (user_id, google_calendar_id, google_event_id, title, starts_at, ends_at, is_private)
  select v_user, x.calendar_id, x.event_id, x.title, x.starts_at, x.ends_at, coalesce(x.is_private, false)
  from jsonb_to_recordset(coalesce(p_upserts, '[]'::jsonb)) as x(
    calendar_id text, event_id text, title text,
    starts_at timestamptz, ends_at timestamptz, is_private boolean
  )
  on conflict (user_id, google_calendar_id, google_event_id) do update set
    title      = excluded.title,
    starts_at  = excluded.starts_at,
    ends_at    = excluded.ends_at,
    is_private = excluded.is_private,
    updated_at = now();

  update google_calendar_import_state
     set sync_token = p_sync_token, last_synced_at = now(), updated_at = now()
   where user_id = v_user;
end;
$$;

revoke execute on function google_import_replace(jsonb, timestamptz, timestamptz, text) from public, anon;
revoke execute on function google_import_apply(jsonb, text[], text)                       from public, anon;
grant  execute on function google_import_replace(jsonb, timestamptz, timestamptz, text) to authenticated;
grant  execute on function google_import_apply(jsonb, text[], text)                       to authenticated;
