-- =====================================================================
-- Testes da 0177 — begin/rollback (nada é gravado em produção).
-- =====================================================================
-- Cada bloco é uma transação que: (a) aplica em memória a DDL da 0177 que o
-- teste usa (idempotente: roda com a 0177 já aplicada ou não), (b) monta dados,
-- (c) assume papel authenticated com request.jwt.claims (auth.uid()), (d) afere
-- com RAISE EXCEPTION em caso de falha, (e) ROLLBACK.
--
-- Rode cada bloco numa chamada separada (begin ... rollback na MESMA chamada).
-- IDs usados (produção, 2026-11-26):
--   Teste Yuri   dc27d309-c1b4-4ae6-a56d-e8fef99f54fa  (conta Google conectada)
--   Yuri Teste 2 b039888d-7816-44c9-9991-135467cf1e05  (duplicado de teste)
--   admin        a5420e67-ea0f-4172-87b8-f5db1ece1314
--   empresa A    07489380-45d0-4484-9f29-189d85750881
--   empresa B    4fde5c39-3a52-4458-9e5d-c84c85431812
-- =====================================================================


-- #####################################################################
-- TESTE 1 — google_mark_reconciled_if_clean: MARCA e NÃO MARCA.
-- #####################################################################
begin;

alter table google_calendar_audit drop constraint if exists google_calendar_audit_action_check;
alter table google_calendar_audit add constraint google_calendar_audit_action_check
  check (action in ('conectado','desconectado','revogado','erro_revogacao','reconciliado_auto','conta_trocada'));

create or replace function google_mark_reconciled_if_clean()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_connected timestamptz; v_existing timestamptz;
begin
  if v_user is null then raise exception 'sem sessão' using errcode='28000'; end if;
  select connected_at into v_connected from google_accounts where user_id = v_user;
  if v_connected is null then return false; end if;
  select auto_apply_from into v_existing from google_calendar_import_state where user_id = v_user;
  if v_existing is not null then return false; end if;
  if exists (select 1 from meetings m
              where m.created_by = v_user and m.starts_at > now()
                and m.google_event_id is not null and m.google_removed_at is null
                and m.created_at < v_connected) then
    return false;
  end if;
  insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
  values (v_user, now(), now())
  on conflict (user_id) do update set auto_apply_from = now(), updated_at = now()
    where google_calendar_import_state.auto_apply_from is null;
  insert into google_calendar_audit (user_id, action, detail)
  values (v_user, 'reconciliado_auto', 'Auto-sync liberado: sem reuniões futuras a reconciliar.');
  return true;
end; $$;

update google_accounts set connected_at = now()
 where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';

-- 1a: sem backlog -> MARCA (true, auto_apply_from setado, auditoria)
delete from meetings where created_by = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from google_calendar_import_state where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"dc27d309-c1b4-4ae6-a56d-e8fef99f54fa","role":"authenticated"}';
do $$
declare v_ok boolean; v_apply timestamptz; v_audit int;
begin
  v_ok := google_mark_reconciled_if_clean();
  if v_ok is not true then raise exception '1a FALHOU: esperava true, veio %', v_ok; end if;
  select auto_apply_from into v_apply from google_calendar_import_state
    where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
  if v_apply is null then raise exception '1a FALHOU: auto_apply_from nulo'; end if;
  select count(*) into v_audit from google_calendar_audit
    where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa' and action = 'reconciliado_auto';
  if v_audit < 1 then raise exception '1a FALHOU: faltou auditoria reconciliado_auto'; end if;
  raise notice '1a OK';
end $$;
reset role;

-- 1b: com reunião futura ligada ao Google criada antes da conexão -> NÃO MARCA
delete from google_calendar_import_state where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
                      google_sync_status, google_event_id, google_email, created_at)
values ('07489380-45d0-4484-9f29-189d85750881', 'T-reconciliar',
        now()+interval '10 days', now()+interval '10 days 1 hour', 'meet',
        'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', 'sincronizado', 'evt_test_1b',
        'yurimateusfranco@gmail.com', now() - interval '1 day');
set local role authenticated;
set local request.jwt.claims = '{"sub":"dc27d309-c1b4-4ae6-a56d-e8fef99f54fa","role":"authenticated"}';
do $$
declare v_ok boolean; v_apply timestamptz;
begin
  v_ok := google_mark_reconciled_if_clean();
  if v_ok is not false then raise exception '1b FALHOU: esperava false, veio %', v_ok; end if;
  select auto_apply_from into v_apply from google_calendar_import_state
    where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
  if v_apply is not null then raise exception '1b FALHOU: auto_apply_from=% (esperava nulo)', v_apply; end if;
  raise notice '1b OK';
end $$;
reset role;

rollback;


-- #####################################################################
-- TESTE 2 — conta duplicada barrada (função conta_em_uso + índice único).
-- #####################################################################
begin;

delete from google_accounts where user_id = 'b039888d-7816-44c9-9991-135467cf1e05';

create or replace function google_mark_reconciled_if_clean()
returns boolean language plpgsql security definer set search_path = public as $$
begin return false; end; $$;

create or replace function google_connect_account(
  p_email text, p_access text, p_refresh text, p_expiry timestamptz, p_scope text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_old_email text; v_is_swap boolean; v_future int; v_blocked_email text;
begin
  if v_user is null then raise exception 'sem sessão' using errcode='28000'; end if;
  if exists (select 1 from google_accounts
              where lower(google_email)=lower(p_email) and user_id <> v_user) then
    return jsonb_build_object('status','conta_em_uso');
  end if;
  select count(*),
         (select m2.google_email from meetings m2
           where m2.created_by=v_user and m2.starts_at>now()
             and m2.google_event_id is not null and m2.google_removed_at is null
             and m2.google_email is not null and lower(m2.google_email)<>lower(p_email)
           group by m2.google_email order by count(*) desc limit 1)
    into v_future, v_blocked_email
    from meetings m
   where m.created_by=v_user and m.starts_at>now()
     and m.google_event_id is not null and m.google_removed_at is null
     and m.google_email is not null and lower(m.google_email)<>lower(p_email);
  if v_future > 0 then
    return jsonb_build_object('status','troca_bloqueada','count',v_future,'email',coalesce(v_blocked_email,'outra conta'));
  end if;
  select google_email into v_old_email from google_accounts where user_id = v_user;
  v_is_swap := v_old_email is not null and lower(v_old_email) <> lower(p_email);
  perform google_upsert_account(p_email, p_access, p_refresh, p_expiry, p_scope);
  if v_is_swap then
    update google_accounts set connected_at = now() where user_id = v_user;
    update google_calendar_import_state
       set sync_token=null, window_start=null, window_end=null, last_full_sync_at=null, updated_at=now()
     where user_id = v_user;
    delete from imported_google_events where user_id = v_user;
    insert into google_calendar_audit (user_id, action, detail)
    values (v_user, 'conta_trocada', jsonb_build_object('de',v_old_email,'para',p_email)::text);
  end if;
  perform google_mark_reconciled_if_clean();
  return jsonb_build_object('status', case when v_is_swap then 'trocada' else 'conectado' end);
end; $$;

-- 2a: 2o usuário tenta conectar conta que pertence a outro -> conta_em_uso; nada salvo
set local role authenticated;
set local request.jwt.claims = '{"sub":"b039888d-7816-44c9-9991-135467cf1e05","role":"authenticated"}';
do $$
declare v jsonb; v_cnt int;
begin
  v := google_connect_account('yurimateusfranco@gmail.com','tok','ref', now()+interval '1 hour','openid');
  if v->>'status' is distinct from 'conta_em_uso' then raise exception '2a FALHOU: veio %', v; end if;
  select count(*) into v_cnt from google_accounts where user_id='b039888d-7816-44c9-9991-135467cf1e05';
  if v_cnt <> 0 then raise exception '2a FALHOU: salvou % linha(s)', v_cnt; end if;
  raise notice '2a OK';
end $$;
reset role;

-- 2b: índice único barra lower(email) duplicado (case-insensitive)
create unique index if not exists google_accounts_email_lower_uniq on google_accounts (lower(google_email));
delete from google_accounts where user_id = 'a5420e67-ea0f-4172-87b8-f5db1ece1314';
do $$
begin
  begin
    insert into google_accounts (user_id, google_email, access_token_enc, token_expiry, scope)
    values ('a5420e67-ea0f-4172-87b8-f5db1ece1314', 'YuriMateusFranco@gmail.com',
            '\x00'::bytea, now()+interval '1 hour', 'openid');
    raise exception '2b FALHOU: o índice único não barrou';
  exception when unique_violation then
    raise notice '2b OK';
  end;
end $$;

rollback;


-- #####################################################################
-- TESTE 3 — auditoria da troca de EMPRESA do timer (empresa_alterada).
-- #####################################################################
begin;

alter table meeting_timer_audit add column if not exists from_company_id uuid;
alter table meeting_timer_audit drop constraint if exists meeting_timer_audit_event_type_check;
alter table meeting_timer_audit add constraint meeting_timer_audit_event_type_check
  check (event_type = any (array['edit'::text,'auto_close'::text,'company_delete'::text,'empresa_alterada'::text]));

create or replace function meetings_timer_sync()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_t record; v_total bigint;
begin
  update meeting_timers
     set scheduled_start = new.starts_at, scheduled_end = new.ends_at, company_id = new.company_id
   where meeting_id = new.id;
  if new.company_id is distinct from old.company_id then
    for v_t in select id, title, started_by from meeting_timers where meeting_id = new.id loop
      v_total := meeting_timer_total_seconds(v_t.id);
      insert into meeting_timer_audit
        (timer_id, company_id, from_company_id, title, started_by, edited_by, edited_at,
         old_seconds, new_seconds, justification, event_type)
      values
        (v_t.id, new.company_id, old.company_id, v_t.title, v_t.started_by, auth.uid(), now(),
         v_total, v_total,
         'Empresa da reunião alterada: as horas do timer passam a contar na empresa de destino.',
         'empresa_alterada');
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists trg_meetings_timer_sync on meetings;
create trigger trg_meetings_timer_sync
  after update of starts_at, ends_at, company_id on meetings
  for each row execute function meetings_timer_sync();

insert into meetings (id, company_id, title, starts_at, ends_at, meeting_type, created_by, google_sync_status)
values ('01770177-0000-0000-0000-000000000001', '07489380-45d0-4484-9f29-189d85750881',
        'T-troca-empresa', now()+interval '2 days', now()+interval '2 days 1 hour', 'meet',
        'a5420e67-ea0f-4172-87b8-f5db1ece1314', 'pendente');
insert into meeting_timers (id, company_id, meeting_id, title, scheduled_start, scheduled_end, started_by)
values ('01770177-0000-0000-0000-000000000002', '07489380-45d0-4484-9f29-189d85750881',
        '01770177-0000-0000-0000-000000000001', 'T-troca-empresa',
        now()+interval '2 days', now()+interval '2 days 1 hour', 'a5420e67-ea0f-4172-87b8-f5db1ece1314');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5420e67-ea0f-4172-87b8-f5db1ece1314","role":"authenticated"}';
update meetings set company_id = '4fde5c39-3a52-4458-9e5d-c84c85431812'
 where id = '01770177-0000-0000-0000-000000000001';
reset role;

do $$
declare v_cnt int; v_from uuid; v_to uuid; v_by uuid; v_timer_co uuid;
begin
  select count(*) into v_cnt from meeting_timer_audit
    where timer_id='01770177-0000-0000-0000-000000000002' and event_type='empresa_alterada';
  if v_cnt <> 1 then raise exception '3 FALHOU: esperava 1 audit, veio %', v_cnt; end if;
  select from_company_id, company_id, edited_by into v_from, v_to, v_by
    from meeting_timer_audit
   where timer_id='01770177-0000-0000-0000-000000000002' and event_type='empresa_alterada';
  if v_from <> '07489380-45d0-4484-9f29-189d85750881' then raise exception '3 FALHOU: from=% (esperava A)', v_from; end if;
  if v_to   <> '4fde5c39-3a52-4458-9e5d-c84c85431812' then raise exception '3 FALHOU: destino=% (esperava B)', v_to; end if;
  if v_by   <> 'a5420e67-ea0f-4172-87b8-f5db1ece1314' then raise exception '3 FALHOU: edited_by=% (esperava admin)', v_by; end if;
  select company_id into v_timer_co from meeting_timers where id='01770177-0000-0000-0000-000000000002';
  if v_timer_co <> '4fde5c39-3a52-4458-9e5d-c84c85431812' then raise exception '3 FALHOU: timer nao propagou (%)', v_timer_co; end if;
  raise notice '3 OK';
end $$;

rollback;


-- #####################################################################
-- TESTE 4 — trava de troca por REUNIÕES: usuário DESCONECTADO (sem linha em
-- google_accounts) com reunião futura em outra conta -> troca_bloqueada.
-- #####################################################################
begin;

create or replace function google_mark_reconciled_if_clean()
returns boolean language plpgsql security definer set search_path = public as $$
begin return false; end; $$;

create or replace function google_connect_account(
  p_email text, p_access text, p_refresh text, p_expiry timestamptz, p_scope text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_old_email text; v_is_swap boolean; v_future int; v_blocked_email text;
begin
  if v_user is null then raise exception 'sem sessão' using errcode='28000'; end if;
  if exists (select 1 from google_accounts where lower(google_email)=lower(p_email) and user_id<>v_user) then
    return jsonb_build_object('status','conta_em_uso');
  end if;
  select count(*),
         (select m2.google_email from meetings m2
           where m2.created_by=v_user and m2.starts_at>now()
             and m2.google_event_id is not null and m2.google_removed_at is null
             and m2.google_email is not null and lower(m2.google_email)<>lower(p_email)
           group by m2.google_email order by count(*) desc limit 1)
    into v_future, v_blocked_email
    from meetings m
   where m.created_by=v_user and m.starts_at>now()
     and m.google_event_id is not null and m.google_removed_at is null
     and m.google_email is not null and lower(m.google_email)<>lower(p_email);
  if v_future > 0 then
    return jsonb_build_object('status','troca_bloqueada','count',v_future,'email',coalesce(v_blocked_email,'outra conta'));
  end if;
  select google_email into v_old_email from google_accounts where user_id=v_user;
  v_is_swap := v_old_email is not null and lower(v_old_email)<>lower(p_email);
  perform google_upsert_account(p_email,p_access,p_refresh,p_expiry,p_scope);
  if v_is_swap then
    update google_accounts set connected_at=now() where user_id=v_user;
    update google_calendar_import_state set sync_token=null, window_start=null, window_end=null, last_full_sync_at=null, updated_at=now() where user_id=v_user;
    delete from imported_google_events where user_id=v_user;
    insert into google_calendar_audit (user_id, action, detail) values (v_user,'conta_trocada', jsonb_build_object('de',v_old_email,'para',p_email)::text);
  end if;
  perform google_mark_reconciled_if_clean();
  return jsonb_build_object('status', case when v_is_swap then 'trocada' else 'conectado' end);
end; $$;

-- Desconectado: sem linha em google_accounts; 1 reunião futura em OUTRA conta.
delete from google_accounts where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from meetings where created_by = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
                      google_sync_status, google_event_id, google_email, created_at)
values ('07489380-45d0-4484-9f29-189d85750881', 'T-futura-outra-conta',
        now()+interval '5 days', now()+interval '5 days 1 hour', 'meet',
        'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', 'sincronizado', 'evt_block',
        'conta.antiga@gmail.com', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"dc27d309-c1b4-4ae6-a56d-e8fef99f54fa","role":"authenticated"}';
do $$
declare v jsonb;
begin
  v := google_connect_account('conta.nova@gmail.com','tok','ref', now()+interval '1 hour','openid');
  if v->>'status' is distinct from 'troca_bloqueada' then raise exception '4 FALHOU: veio %', v; end if;
  if (v->>'count')::int <> 1 then raise exception '4 FALHOU: count=%', v->>'count'; end if;
  if v->>'email' is distinct from 'conta.antiga@gmail.com' then raise exception '4 FALHOU: email=%', v->>'email'; end if;
  if exists (select 1 from google_accounts where user_id='dc27d309-c1b4-4ae6-a56d-e8fef99f54fa') then
    raise exception '4 FALHOU: salvou conta apesar do bloqueio';
  end if;
  raise notice '4 OK';
end $$;
reset role;

rollback;


-- #####################################################################
-- TESTE 5 — Desconectar limpa espelho/sync e MANTÉM auto_apply_from.
-- #####################################################################
begin;

create or replace function google_delete_account(p_revoked boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'sem sessão' using errcode='28000'; end if;
  delete from google_accounts where user_id = v_user;
  update google_calendar_import_state
     set sync_token=null, window_start=null, window_end=null, last_full_sync_at=null, updated_at=now()
   where user_id = v_user;
  delete from imported_google_events where user_id = v_user;
  insert into google_calendar_audit (user_id, action)
  values (v_user, case when p_revoked then 'revogado' else 'desconectado' end);
end; $$;

insert into google_calendar_import_state (user_id, sync_token, window_start, window_end, last_full_sync_at, last_synced_at, auto_apply_from, updated_at)
values ('dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', 'TOKEN_ANTIGO', now()-interval '3 months', now()+interval '12 months', now()-interval '1 hour', now()-interval '1 hour', now()-interval '2 days', now())
on conflict (user_id) do update set sync_token='TOKEN_ANTIGO', window_start=now()-interval '3 months',
  window_end=now()+interval '12 months', last_full_sync_at=now()-interval '1 hour', auto_apply_from=now()-interval '2 days';
insert into imported_google_events (user_id, google_event_id, title, starts_at, ends_at, is_private)
values ('dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', 'imp_evt_1', 'Evento espelho', now()+interval '1 day', now()+interval '1 day 1 hour', false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"dc27d309-c1b4-4ae6-a56d-e8fef99f54fa","role":"authenticated"}';
select google_delete_account(false);
reset role;

do $$
declare v_acc int; v_imp int; v_tok text; v_apply timestamptz; v_audit int;
begin
  select count(*) into v_acc from google_accounts where user_id='dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
  if v_acc <> 0 then raise exception '5 FALHOU: conta nao apagada (%)', v_acc; end if;
  select count(*) into v_imp from imported_google_events where user_id='dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
  if v_imp <> 0 then raise exception '5 FALHOU: espelho nao limpo (%)', v_imp; end if;
  select sync_token, auto_apply_from into v_tok, v_apply from google_calendar_import_state where user_id='dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
  if v_tok is not null then raise exception '5 FALHOU: sync_token=% (esperava nulo)', v_tok; end if;
  if v_apply is null then raise exception '5 FALHOU: auto_apply_from foi apagado (deveria manter)'; end if;
  select count(*) into v_audit from google_calendar_audit where user_id='dc27d309-c1b4-4ae6-a56d-e8fef99f54fa' and action='desconectado';
  if v_audit < 1 then raise exception '5 FALHOU: faltou auditoria desconectado'; end if;
  raise notice '5 OK';
end $$;

rollback;
