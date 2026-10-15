-- =====================================================================
-- CRM/Timer - Monvatti :: Sincronização Digisac — ETAPA 1 (metadados)
-- =====================================================================
-- Sincroniza, de hora em hora, os METADADOS das mensagens dos grupos de clientes
-- (Digisac) para o banco, para a ETAPA 2 calcular o tempo de atendimento. A carga
-- do histórico começa em 01/09/2026 (00h BRT).
--
-- PRIVACIDADE: nunca gravamos texto de mensagem, o objeto `data`, fromId/toId,
-- telefone ou nome de contato. `text_hash` é SHA-256 do texto normalizado, SÓ
-- para mensagens da EQUIPE (isFromMe=true), para detectar comunicados repetidos
-- na etapa 2; nulo para mensagens do cliente. Não guardamos type 'ticket'/'reaction'.
--
-- EXCEÇÃO DE service_role (2ª exceção documentada, aprovada pelo Mauricio): a
-- ESCRITA nas tabelas digisac_* (e a notificação de alerta) é feita SOMENTE pela
-- Edge Function digisac-sync, que usa a service_role internamente. O código do
-- site (Next) NUNCA usa service_role. As tabelas têm RLS com SELECT só para admin
-- e NENHUMA policy de escrita (a service_role grava por bypass de RLS, de dentro
-- da função). Escopo exato: tabelas digisac_users / digisac_messages /
-- digisac_sync_cursor / digisac_sync_runs e a RPC digisac_alert.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists digisac_users (
  id         text primary key,          -- id do Digisac
  name       text,
  email      text,
  profile_id uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists digisac_messages (
  id              text primary key,      -- id da mensagem no Digisac
  contact_id      text not null,
  ticket_id       text,
  digisac_user_id text,
  is_from_me      boolean,
  is_from_bot     boolean,
  is_comment      boolean,
  visible         boolean,
  origin          text,
  type            text,
  sent_at         timestamptz not null,
  text_hash       text,                  -- SHA-256 (só equipe); nulo p/ cliente
  synced_at       timestamptz not null default now()
  -- SEM company_id de propósito: a empresa vem no cálculo por
  -- companies.whatsapp_contact_id, então correções de vínculo valem p/ o histórico.
);
create index if not exists digisac_messages_contact_sent_idx on digisac_messages (contact_id, sent_at);
create index if not exists digisac_messages_user_sent_idx on digisac_messages (digisac_user_id, sent_at);

create table if not exists digisac_sync_cursor (
  contact_id   text primary key,
  last_sent_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists digisac_sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  status             text,               -- 'ok' | 'parcial' | 'erro'
  contacts_processed integer not null default 0,
  messages_upserted  integer not null default 0,
  requests           integer not null default 0,
  error_kind         text,
  error_message      text
);
create index if not exists digisac_sync_runs_started_idx on digisac_sync_runs (started_at desc);

-- ---------------------------------------------------------------------
-- RLS: SELECT só admin; NENHUMA policy de escrita (service_role grava por bypass).
-- ---------------------------------------------------------------------
alter table digisac_users       enable row level security;
alter table digisac_messages    enable row level security;
alter table digisac_sync_cursor enable row level security;
alter table digisac_sync_runs   enable row level security;

drop policy if exists dsu_select on digisac_users;
create policy dsu_select on digisac_users       for select using ((select is_admin()));
drop policy if exists dsm_select on digisac_messages;
create policy dsm_select on digisac_messages    for select using ((select is_admin()));
drop policy if exists dsc_select on digisac_sync_cursor;
create policy dsc_select on digisac_sync_cursor for select using ((select is_admin()));
drop policy if exists dsr_select on digisac_sync_runs;
create policy dsr_select on digisac_sync_runs   for select using ((select is_admin()));

grant select on digisac_users, digisac_messages, digisac_sync_cursor, digisac_sync_runs
  to authenticated;

-- ---------------------------------------------------------------------
-- Tipos de notificação dos alertas do Digisac (estende o CHECK existente,
-- preservando todos os tipos atuais).
-- ---------------------------------------------------------------------
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (
  type = any (array[
    'mencionado','resposta_recebida','tarefa_atribuida','tarefa_recorrente_atribuida',
    'listagem_ajuste_solicitado','reuniao_convite','reuniao_cancelada',
    'empresa_onboarding','empresa_renovacao',
    'digisac_sync_auth','digisac_sync_error','digisac_sync_stalled'
  ]::text[])
);

-- ---------------------------------------------------------------------
-- Alerta aos admins (dedup por tipo: no máximo 1 a cada 6 horas). SEM token/conteúdo.
-- ---------------------------------------------------------------------
create or replace function digisac_alert(p_type text, p_title text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare r record;
begin
  if exists (
    select 1 from notifications
     where type = p_type and created_at > now() - interval '6 hours'
  ) then
    return;
  end if;
  for r in select id from profiles where role = 'admin' loop
    perform push_notification(r.id, p_type, p_title, null, null, 'digisac_sync', null, null);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Watchdog: sem execução 'ok'/'parcial' nas últimas 3h (só depois de já ter
-- rodado ao menos uma vez — não alarma antes da primeira execução).
-- ---------------------------------------------------------------------
create or replace function digisac_watchdog()
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from digisac_sync_runs) then
    return;
  end if;
  if not exists (
    select 1 from digisac_sync_runs
     where status in ('ok','parcial')
       and coalesce(finished_at, started_at) > now() - interval '3 hours'
  ) then
    perform digisac_alert('digisac_sync_stalled', 'Sincronização do Digisac parada');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Agendamento (pg_cron + pg_net). O segredo x-sync-secret vem do Vault
-- ('digisac_sync_secret'), que precisa ter o MESMO valor do segredo
-- DIGISAC_SYNC_SECRET da Edge Function (ver passos de implantação).
-- ---------------------------------------------------------------------
select cron.unschedule('digisac-sync-hourly')
 where exists (select 1 from cron.job where jobname = 'digisac-sync-hourly');
select cron.schedule(
  'digisac-sync-hourly',
  '7 * * * *',
  $cron$
  select net.http_post(
    url := 'https://odpcgeiaikdvpoydcfyu.supabase.co/functions/v1/digisac-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digisac_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

select cron.unschedule('digisac-watchdog-hourly')
 where exists (select 1 from cron.job where jobname = 'digisac-watchdog-hourly');
select cron.schedule(
  'digisac-watchdog-hourly',
  '37 * * * *',
  $cron$ select public.digisac_watchdog(); $cron$
);
