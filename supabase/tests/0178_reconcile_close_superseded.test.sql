-- =====================================================================
-- Testes da 0178 — begin/rollback (nada é gravado em produção).
-- =====================================================================
-- Dois casos:
--   1a  AUTO-SYNC aplica sozinho uma mudança → fecha o item pendente daquela
--       reunião como 'superado' + resolution_reason 'aplicado_automaticamente'.
--   1b  EXCLUIR a reunião → gatilho BEFORE DELETE fecha o item pendente como
--       'superado' + resolution_reason 'reuniao_excluida' ANTES do FK pôr
--       meeting_id em null.
--
-- Cada bloco: (a) aplica em memória a DDL da 0178 que usa (idempotente: roda com
-- a 0178 já aplicada ou não), (b) monta dados, (c) assume authenticated via
-- request.jwt.claims, (d) afere com RAISE EXCEPTION, (e) ROLLBACK.
-- Rode cada bloco numa chamada separada (begin ... rollback na MESMA chamada).
-- IDs (produção, 2026-11-26):
--   Teste Yuri  dc27d309-c1b4-4ae6-a56d-e8fef99f54fa
--   empresa A   07489380-45d0-4484-9f29-189d85750881
-- =====================================================================


-- #####################################################################
-- TESTE 1a — meetings_apply_google_sync fecha o pendente ao aplicar sozinho.
-- #####################################################################
begin;

-- DDL da 0178 (idempotente).
alter table meeting_google_reconciliation add column if not exists resolution_reason text;
alter table meeting_google_reconciliation drop constraint if exists meeting_google_reconciliation_status_check;
alter table meeting_google_reconciliation add constraint meeting_google_reconciliation_status_check
  check (status in ('pending','applied','dismissed','superado'));

create or replace function _mgr_close_superseded(p_meeting uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update meeting_google_reconciliation
     set status = 'superado', resolution_reason = p_reason, resolved_at = now()
   where meeting_id = p_meeting and status = 'pending';
end; $$;

-- meetings_apply_google_sync com o close (só o trecho do ramo reconciliado que
-- importa para este teste; os demais ramos são idênticos à 0176/0178).
create or replace function meetings_apply_google_sync(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_email text; v_trusted boolean;
  v_op jsonb; v_cur record; v_upd timestamptz; v_motivo text;
  v_applied int := 0; v_queued int := 0; v_cancels jsonb[] := '{}'; c jsonb;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select auto_apply_from is not null into v_trusted from google_calendar_import_state where user_id = v_user;
  select google_email into v_email from google_accounts where user_id = v_user;
  if not coalesce(v_trusted, false) then
    return jsonb_build_object('applied', 0, 'queued', 0, 'trusted', false);
  end if;
  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin
      select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.google_pushed_at,
             m.google_email, m.google_sync_status into v_cur
        from meetings m
       where m.created_by = v_user and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null limit 1;
      if not found then continue; end if;
      v_motivo := nullif(v_op->>'motivo', '');
      if v_motivo is not null then perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo); v_queued := v_queued + 1; continue; end if;
      if v_cur.google_email is null or v_email is null or v_cur.google_email <> v_email then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'conta_diferente');
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_queued := v_queued + 1; continue;
      end if;
      if coalesce((v_op->>'cancel')::boolean, false) then v_cancels := v_cancels || v_op; continue; end if;
      if v_cur.google_sync_status <> 'sincronizado' then perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente'); v_queued := v_queued + 1; continue; end if;
      if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario'); v_queued := v_queued + 1; continue; end if;
      if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido'); v_queued := v_queued + 1; continue; end if;
      v_upd := nullif(v_op->>'updated', '')::timestamptz;
      if v_upd is not null and v_cur.google_pushed_at is not null and v_upd <= v_cur.google_pushed_at then continue; end if;
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)') = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then continue; end if;
      perform _mgr_close_superseded(v_cur.id, 'aplicado_automaticamente');
      perform _apply_meeting_google_change(v_cur.id, v_op->>'title',
        (v_op->>'startsAt')::timestamptz, (v_op->>'endsAt')::timestamptz,
        nullif(v_op->>'meetLink', ''), false);
      v_applied := v_applied + 1;
    exception when others then
      begin perform _mgr_upsert(v_cur.id, v_user, v_op, 'erro_interno'); v_queued := v_queued + 1; exception when others then null; end;
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'queued', v_queued, 'trusted', true);
end; $$;

-- Dados: usuário reconciliado (trusted), reunião futura sincronizada com item
-- pendente na fila. google_email bate com a conta conectada.
update google_accounts set google_email = 'teste0178@gmail.com', connected_at = now()
 where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from meeting_google_reconciliation where owner_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from meetings where created_by = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa' and google_event_id = 'evt0178a';
insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
values ('dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', now(), now())
on conflict (user_id) do update set auto_apply_from = now(), updated_at = now();

insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
                      google_sync_status, google_event_id, google_email, google_pushed_at, created_at)
values ('07489380-45d0-4484-9f29-189d85750881', 'Antigo',
        now()+interval '3 days', now()+interval '3 days 1 hour', 'meet',
        'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', 'sincronizado', 'evt0178a',
        'teste0178@gmail.com', null, now());

insert into meeting_google_reconciliation
  (meeting_id, owner_id, company_id, proposed_action, motivo,
   crm_title, google_title, google_event_id, status, detected_at)
select m.id, m.created_by, m.company_id, 'update', null,
       'Antigo', 'Novo', 'evt0178a', 'pending', now()
  from meetings m where m.google_event_id = 'evt0178a';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dc27d309-c1b4-4ae6-a56d-e8fef99f54fa","role":"authenticated"}';

do $$
declare v_mid uuid; v_ops jsonb; v_res jsonb; v_title text; v_status text; v_reason text;
begin
  select id into v_mid from meetings where google_event_id = 'evt0178a' and created_by = auth.uid();
  v_ops := jsonb_build_array(jsonb_build_object(
    'eventId','evt0178a','title','Novo',
    'startsAt',(now()+interval '3 days')::text,
    'endsAt',(now()+interval '3 days 1 hour')::text,
    'updated',now()::text));
  v_res := meetings_apply_google_sync(v_ops);
  if coalesce((v_res->>'applied')::int,0) <> 1 then
    raise exception '1a FALHOU: esperava applied=1, veio %', v_res; end if;

  select title into v_title from meetings where id = v_mid;
  if v_title <> 'Novo' then raise exception '1a FALHOU: título não aplicado (%).', v_title; end if;

  select status, resolution_reason into v_status, v_reason
    from meeting_google_reconciliation where meeting_id = v_mid;
  if v_status is distinct from 'superado' then
    raise exception '1a FALHOU: item deveria estar superado, está %.', v_status; end if;
  if v_reason is distinct from 'aplicado_automaticamente' then
    raise exception '1a FALHOU: resolution_reason deveria ser aplicado_automaticamente, é %.', v_reason; end if;

  -- Nada mais pendente para o dono: o Concluir destravaria.
  if exists (select 1 from meeting_google_reconciliation
              where owner_id = auth.uid() and status = 'pending' and meeting_id is not null) then
    raise exception '1a FALHOU: ainda há pendente para o dono.'; end if;

  raise notice '1a OK: aplicou e fechou o pendente como superado/aplicado_automaticamente.';
end $$;

rollback;


-- #####################################################################
-- TESTE 1b — excluir a reunião fecha o pendente (gatilho BEFORE DELETE).
-- #####################################################################
begin;

alter table meeting_google_reconciliation add column if not exists resolution_reason text;
alter table meeting_google_reconciliation drop constraint if exists meeting_google_reconciliation_status_check;
alter table meeting_google_reconciliation add constraint meeting_google_reconciliation_status_check
  check (status in ('pending','applied','dismissed','superado'));

create or replace function _mgr_close_superseded(p_meeting uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update meeting_google_reconciliation
     set status = 'superado', resolution_reason = p_reason, resolved_at = now()
   where meeting_id = p_meeting and status = 'pending';
end; $$;

create or replace function meetings_close_reconcile_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.company_id is not null
     and not exists (select 1 from companies c where c.id = old.company_id) then
    return old;
  end if;
  perform _mgr_close_superseded(old.id, 'reuniao_excluida');
  return old;
end; $$;

drop trigger if exists trg_meetings_close_reconcile_on_delete on meetings;
create trigger trg_meetings_close_reconcile_on_delete
  before delete on meetings for each row execute function meetings_close_reconcile_on_delete();

-- Dados: reunião futura com item pendente na fila.
delete from meeting_google_reconciliation where owner_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from meetings where created_by = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa' and google_event_id = 'evt0178b';
insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
                      google_sync_status, google_event_id, created_at)
values ('07489380-45d0-4484-9f29-189d85750881', 'Para excluir',
        now()+interval '4 days', now()+interval '4 days 1 hour', 'meet',
        'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', 'sincronizado', 'evt0178b', now());

insert into meeting_google_reconciliation
  (meeting_id, owner_id, company_id, proposed_action, motivo,
   crm_title, google_event_id, status, detected_at)
select m.id, m.created_by, m.company_id, 'cancel_delete', 'cancelado_google',
       'Para excluir', 'evt0178b', 'pending', now()
  from meetings m where m.google_event_id = 'evt0178b';

-- Exclui a reunião. O gatilho BEFORE DELETE (DEFINER) dispara em QUALQUER
-- caminho de exclusão; aferimos que fechou o pendente antes do FK.
delete from meetings where google_event_id = 'evt0178b'
   and created_by = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';

do $$
declare v_rid uuid; v_status text; v_reason text;
begin
  select r.id into v_rid
    from meeting_google_reconciliation r where r.google_event_id = 'evt0178b';

  select status, resolution_reason into v_status, v_reason
    from meeting_google_reconciliation where id = v_rid;
  if v_status is distinct from 'superado' then
    raise exception '1b FALHOU: item deveria estar superado, está %.', v_status; end if;
  if v_reason is distinct from 'reuniao_excluida' then
    raise exception '1b FALHOU: resolution_reason deveria ser reuniao_excluida, é %.', v_reason; end if;
  if (select meeting_id from meeting_google_reconciliation where id = v_rid) is not null then
    raise exception '1b FALHOU: meeting_id deveria ter virado null pelo FK.'; end if;

  raise notice '1b OK: exclusão fechou o pendente como superado/reuniao_excluida.';
end $$;

rollback;


-- #####################################################################
-- TESTE 5 — excluir empresa com histórico volta a funcionar (log_company_event).
-- Empresa com template, instância, anotação, consultor, reunião e timer: a
-- exclusão (cascade) dispara os gatilhos de histórico de 0168 para a empresa já
-- apagada; sem o guard, o insert em company_events dá 23503 e desfaz tudo.
-- #####################################################################
begin;

-- Guard da 0178 (idempotente).
create or replace function log_company_event(
  p_company uuid, p_type text, p_summary text,
  p_details jsonb default '{}'::jsonb, p_actor uuid default null,
  p_source text default null, p_source_id text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_company is null then return; end if;
  if not exists (select 1 from companies c where c.id = p_company) then return; end if;
  insert into company_events (company_id, event_type, summary, details, actor_id, source, source_id)
  values (p_company, p_type, p_summary, coalesce(p_details, '{}'::jsonb), p_actor, p_source, p_source_id)
  on conflict (source, source_id) where source is not null do nothing;
end; $$;

do $t$
declare v_admin uuid := 'a5420e67-ea0f-4172-87b8-f5db1ece1314'; v_co uuid; v_m uuid; n int;
begin
  insert into companies (name) values ('EMPRESA TESTE 0178 DELETE') returning id into v_co;
  insert into task_templates (company_id, collaborator_id, created_by, title, kind)
    values (v_co, v_admin, v_admin, 'TPL 0178', 'unica');
  insert into task_instances (company_id, collaborator_id, title)
    values (v_co, v_admin, 'INST 0178');
  insert into company_notes (company_id, author_id, content_html)
    values (v_co, v_admin, '<p>nota 0178</p>');
  insert into company_consultants (company_id, consultant_id)
    values (v_co, v_admin);
  insert into meetings (company_id, title, starts_at, ends_at, created_by, google_sync_status)
    values (v_co, 'REU 0178', now()+interval '1 day', now()+interval '1 day 1 hour', v_admin, 'sincronizado')
    returning id into v_m;
  insert into meeting_timers (company_id, started_by, meeting_id)
    values (v_co, v_admin, v_m);

  -- Garante que há histórico (senão o teste não provaria nada).
  select count(*) into n from company_events where company_id = v_co;
  if n = 0 then raise exception '5 SETUP: nenhum company_event gerado.'; end if;

  -- Exclui a empresa (o que deleteCompany faz). Antes da 0178: 23503.
  delete from companies where id = v_co;

  if exists (select 1 from companies where id = v_co) then raise exception '5 FALHOU: empresa ainda existe'; end if;
  select count(*) into n from task_templates     where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou template (%)', n; end if;
  select count(*) into n from task_instances     where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou instancia (%)', n; end if;
  select count(*) into n from company_notes       where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou nota (%)', n; end if;
  select count(*) into n from company_consultants where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou consultor (%)', n; end if;
  select count(*) into n from meetings            where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou reuniao (%)', n; end if;
  select count(*) into n from meeting_timers      where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou timer (%)', n; end if;
  select count(*) into n from company_events      where company_id = v_co; if n <> 0 then raise exception '5 FALHOU: sobrou evento (%)', n; end if;

  raise notice '5 OK: empresa excluida, nada ligado sobrou.';
end $t$;

rollback;
