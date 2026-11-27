-- =====================================================================
-- Testes da 0179 — begin/rollback (nada é gravado em produção).
-- =====================================================================
-- Uma única transação: aplica a DDL da 0179 (idempotente), monta dados de um
-- dono RECONCILIADO (Teste Yuri) e exercita as regras a–e via
-- meeting_reconcile_enqueue e meetings_apply_google_sync, aferindo com RAISE
-- EXCEPTION. now() é constante na transação (passado/futuro por interval).
-- Rode o arquivo inteiro numa única chamada (begin … rollback no mesmo bloco).
--
-- IDs (produção):
--   Teste Yuri  dc27d309-c1b4-4ae6-a56d-e8fef99f54fa
--   empresa A   07489380-45d0-4484-9f29-189d85750881
--
-- Cenários:
--   1  passada + nao_encontrada: nada na fila, reunião e timer intactos.
--   2  futura sem timer + cancel: reunião excluída, notificação, nada na fila.
--   3  futura com timer + cancel: reunião mantida, notificação, nada na fila.
--   4  futura nao_encontrada 1ª varredura: nada; 2ª: aplica (exclui + notifica).
--   5  4 futuras canceladas no mesmo lote: todas na fila (muitos_cancelamentos).
--   6  4 passadas + 1 futura canceladas: passadas resolvidas, futura aplicada.
--   7  (apply) futura sem timer + cancel no ramo reconciliado: excluída, notif.
-- =====================================================================
begin;

-- ---------- DDL da 0179 (idempotente) ----------
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type = any (array['mencionado','resposta_recebida','tarefa_atribuida',
    'tarefa_recorrente_atribuida','listagem_ajuste_solicitado','reuniao_convite',
    'reuniao_cancelada','empresa_onboarding','empresa_renovacao','digisac_sync_auth',
    'digisac_sync_error','digisac_sync_stalled','reuniao_em_andamento',
    'reuniao_encerrada_auto','reuniao_fora_google','agenda_conta_diferente',
    'agenda_evento_apagado']));

create or replace function _mgr_resolve_past_gone(p_meeting uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_timer boolean;
begin
  if p_reason = 'cancelado_google' then
    select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_timer;
    if v_timer then
      update meetings set google_missing_at = coalesce(google_missing_at, now()) where id = p_meeting;
    else
      update meetings set google_removed_at = coalesce(google_removed_at, now()) where id = p_meeting and google_removed_at is null;
    end if;
  else
    update meetings set google_missing_at = coalesce(google_missing_at, now()) where id = p_meeting;
  end if;
  perform _mgr_close_superseded(p_meeting, 'reuniao_passada');
end; $$;

create or replace function _mgr_notify_evento_apagado(
  p_meeting uuid, p_owner uuid, p_title text, p_kept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if exists (select 1 from notifications
              where type = 'agenda_evento_apagado' and source_id = p_meeting) then
    return;
  end if;
  select company_id into v_company from meetings where id = p_meeting;
  if p_kept then
    perform push_notification(p_owner, 'agenda_evento_apagado',
      'Evento da reunião "' || coalesce(p_title, '(sem título)') || '" apagado no Google',
      'O evento foi apagado na sua agenda Google. A reunião foi mantida no CRM porque tem horas registradas.',
      v_company, 'meeting', p_meeting, null);
  else
    perform push_notification(p_owner, 'agenda_evento_apagado',
      'Reunião "' || coalesce(p_title, '(sem título)') || '" removida do CRM',
      'A reunião foi removida do CRM porque o evento foi apagado na sua agenda Google.',
      v_company, 'meeting', p_meeting, null);
  end if;
end; $$;

create or replace function _mgr_future_gone_apply(p_meeting uuid, p_owner uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare v_timer boolean;
begin
  select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_timer;
  perform _mgr_notify_evento_apagado(p_meeting, p_owner, p_title, v_timer);
  perform _mgr_close_superseded(p_meeting, 'aplicado_automaticamente');
  perform _apply_meeting_google_change(p_meeting, null, null, null, null, true);
end; $$;

-- enqueue (0179 §5)
create or replace function meeting_reconcile_enqueue(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_email text; v_op jsonb; v_cur record;
  v_motivo text; v_count int := 0; v_future_gone jsonb[] := '{}'; v_el jsonb;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select google_email into v_email from google_accounts where user_id = v_user;
  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin
      select m.id, m.title, m.starts_at, m.ends_at, m.google_email,
             m.google_sync_status, m.google_missing_at into v_cur
        from meetings m
       where m.created_by = v_user and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null limit 1;
      if not found then continue; end if;
      v_motivo := nullif(v_op->>'motivo', '');
      if v_motivo is distinct from 'conta_diferente'
         and (v_cur.google_email is null or v_email is null or v_cur.google_email <> v_email) then
        v_motivo := 'conta_diferente';
      end if;
      if v_motivo = 'conta_diferente' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_count := v_count + 1; continue;
      end if;
      if v_motivo = 'nao_encontrada' then
        if v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'nao_encontrada');
        elsif v_cur.google_missing_at is null then
          update meetings set google_missing_at = now() where id = v_cur.id;
        else
          v_future_gone := v_future_gone || v_op;
        end if;
        continue;
      end if;
      if coalesce((v_op->>'cancel')::boolean, false) then
        if v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'cancelado_google');
        else
          v_future_gone := v_future_gone || v_op;
        end if;
        continue;
      end if;
      if v_motivo is not null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo); v_count := v_count + 1; continue;
      end if;
      update meetings set google_missing_at = null
       where id = v_cur.id and google_missing_at is not null;
      if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario'); v_count := v_count + 1; continue;
      end if;
      if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido'); v_count := v_count + 1; continue;
      end if;
      if v_cur.google_sync_status <> 'sincronizado' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente'); v_count := v_count + 1; continue;
      end if;
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)') = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then continue; end if;
      perform _mgr_upsert(v_cur.id, v_user, v_op, null); v_count := v_count + 1;
    exception when others then null;
    end;
  end loop;
  if coalesce(array_length(v_future_gone, 1), 0) > 3 then
    foreach v_el in array v_future_gone loop
      begin
        select m.id into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (v_el->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then perform _mgr_upsert(v_cur.id, v_user, v_el, 'muitos_cancelamentos'); v_count := v_count + 1; end if;
      exception when others then null; end;
    end loop;
  else
    foreach v_el in array v_future_gone loop
      begin
        select m.id, m.title into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (v_el->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then perform _mgr_future_gone_apply(v_cur.id, v_user, v_cur.title); end if;
      exception when others then null; end;
    end loop;
  end if;
  update google_calendar_import_state set last_reconcile_scan_at = now() where user_id = v_user;
  return jsonb_build_object('enqueued', v_count);
end; $$;

-- apply, ramo reconciliado (0179 §6) — versão compacta só do necessário aos testes.
create or replace function meetings_apply_google_sync(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_email text; v_trusted boolean; v_op jsonb; v_cur record;
  v_upd timestamptz; v_motivo text; v_applied int := 0; v_queued int := 0;
  v_future_gone jsonb[] := '{}'; c jsonb;
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
             m.google_email, m.google_sync_status, m.google_missing_at into v_cur
        from meetings m
       where m.created_by = v_user and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null limit 1;
      if not found then continue; end if;
      v_motivo := nullif(v_op->>'motivo', '');
      if v_motivo = 'nao_encontrada' then
        if v_cur.ends_at < now() then perform _mgr_resolve_past_gone(v_cur.id, 'nao_encontrada'); v_applied := v_applied + 1;
        elsif v_cur.google_missing_at is null then update meetings set google_missing_at = now() where id = v_cur.id;
        else v_future_gone := v_future_gone || v_op; end if;
        continue;
      end if;
      if v_motivo is not null then perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo); v_queued := v_queued + 1; continue; end if;
      if v_cur.google_email is null or v_email is null or v_cur.google_email <> v_email then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'conta_diferente');
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_queued := v_queued + 1; continue;
      end if;
      if coalesce((v_op->>'cancel')::boolean, false) then
        if v_cur.ends_at < now() then perform _mgr_resolve_past_gone(v_cur.id, 'cancelado_google'); v_applied := v_applied + 1;
        else v_future_gone := v_future_gone || v_op; end if;
        continue;
      end if;
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
  if coalesce(array_length(v_future_gone, 1), 0) > 3 then
    foreach c in array v_future_gone loop
      begin
        select m.id into v_cur from meetings m where m.created_by = v_user and m.google_event_id = (c->>'eventId') and m.google_removed_at is null limit 1;
        if found then perform _mgr_upsert(v_cur.id, v_user, c, 'muitos_cancelamentos'); v_queued := v_queued + 1; end if;
      exception when others then null; end;
    end loop;
  else
    foreach c in array v_future_gone loop
      begin
        select m.id, m.title into v_cur from meetings m where m.created_by = v_user and m.google_event_id = (c->>'eventId') and m.google_removed_at is null limit 1;
        if found then perform _mgr_future_gone_apply(v_cur.id, v_user, v_cur.title); v_applied := v_applied + 1; end if;
      exception when others then null; end;
    end loop;
  end if;
  return jsonb_build_object('applied', v_applied, 'queued', v_queued, 'trusted', true);
end; $$;

-- ---------- Dados (dono reconciliado, conta bate) ----------
update google_accounts set google_email = 'teste0179@gmail.com', connected_at = now()
 where user_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from meeting_google_reconciliation where owner_id = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
delete from meetings where created_by = 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa'
   and google_event_id like 't79%';
insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
values ('dc27d309-c1b4-4ae6-a56d-e8fef99f54fa', now(), now())
on conflict (user_id) do update set auto_apply_from = now(), updated_at = now();

do $seed$
declare v_co uuid := '07489380-45d0-4484-9f29-189d85750881';
        v_u  uuid := 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
        v_m  uuid; i int;
begin
  -- M1 passada (nao_encontrada) + timer
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email)
  values (v_co, 'M1 passada', now()-interval '5 days', now()-interval '5 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m1', 'teste0179@gmail.com') returning id into v_m;
  insert into meeting_timers (company_id, started_by, meeting_id) values (v_co, v_u, v_m);

  -- M2 futura sem timer (cancel via enqueue)
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email)
  values (v_co, 'M2 futura', now()+interval '2 days', now()+interval '2 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m2', 'teste0179@gmail.com');

  -- M3 futura com timer (cancel via enqueue)
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email)
  values (v_co, 'M3 futura timer', now()+interval '3 days', now()+interval '3 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m3', 'teste0179@gmail.com') returning id into v_m;
  insert into meeting_timers (company_id, started_by, meeting_id) values (v_co, v_u, v_m);

  -- M4 futura sem timer (nao_encontrada 2 varreduras)
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email)
  values (v_co, 'M4 futura', now()+interval '4 days', now()+interval '4 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m4', 'teste0179@gmail.com');

  -- M5a..d: 4 futuras (muitos_cancelamentos)
  for i in 1..4 loop
    insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
      google_sync_status, google_event_id, google_email)
    values (v_co, 'M5 '||i, now()+interval '5 days', now()+interval '5 days'+interval '1 hour',
      'meet', v_u, 'sincronizado', 't79_m5'||i, 'teste0179@gmail.com');
  end loop;

  -- M6: 4 passadas + 1 futura sem timer (lote misto)
  for i in 1..4 loop
    insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
      google_sync_status, google_event_id, google_email)
    values (v_co, 'M6p '||i, now()-interval '6 days', now()-interval '6 days'+interval '1 hour',
      'meet', v_u, 'sincronizado', 't79_m6p'||i, 'teste0179@gmail.com');
  end loop;
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email)
  values (v_co, 'M6 futura', now()+interval '6 days', now()+interval '6 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m6f', 'teste0179@gmail.com');

  -- M7 futura sem timer (apply reconciliado)
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email)
  values (v_co, 'M7 futura', now()+interval '7 days', now()+interval '7 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m7', 'teste0179@gmail.com');

  -- M8 PASSADA + cancelado_google + COM timer (horas registradas): deve virar
  -- google_missing_at (NÃO removed) para não sumir do portal do cliente.
  insert into meetings (company_id, title, starts_at, ends_at, meeting_type, created_by,
    google_sync_status, google_event_id, google_email, client_hidden)
  values (v_co, 'M8 passada c/ horas', now()-interval '8 days', now()-interval '8 days'+interval '1 hour',
    'meet', v_u, 'sincronizado', 't79_m8', 'teste0179@gmail.com', false) returning id into v_m;
  insert into meeting_timers (company_id, started_by, meeting_id) values (v_co, v_u, v_m);
end $seed$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"dc27d309-c1b4-4ae6-a56d-e8fef99f54fa","role":"authenticated"}';

do $t$
declare v_u uuid := 'dc27d309-c1b4-4ae6-a56d-e8fef99f54fa';
        v_mid uuid; v_n int; v_res jsonb;
begin
  -- 1 — passada + nao_encontrada
  select id into v_mid from meetings where google_event_id = 't79_m1';
  perform meeting_reconcile_enqueue(jsonb_build_array(jsonb_build_object('eventId','t79_m1','motivo','nao_encontrada')));
  if exists (select 1 from meeting_google_reconciliation where meeting_id = v_mid and status='pending') then
    raise exception '1 FALHOU: criou pendência para passada.'; end if;
  if not exists (select 1 from meetings where id = v_mid) then raise exception '1 FALHOU: reunião sumiu.'; end if;
  if not exists (select 1 from meeting_timers where meeting_id = v_mid) then raise exception '1 FALHOU: timer sumiu.'; end if;
  if (select google_missing_at from meetings where id = v_mid) is null then raise exception '1 FALHOU: google_missing_at não marcado.'; end if;
  raise notice '1 OK: passada+nao_encontrada → sem fila, reunião e timer intactos, missing marcado.';

  -- 2 — futura sem timer + cancel (enqueue) → exclui + notifica
  select id into v_mid from meetings where google_event_id = 't79_m2';
  perform meeting_reconcile_enqueue(jsonb_build_array(jsonb_build_object('eventId','t79_m2','cancel',true)));
  if exists (select 1 from meetings where id = v_mid) then raise exception '2 FALHOU: reunião futura sem timer não foi excluída.'; end if;
  if not exists (select 1 from notifications where type='agenda_evento_apagado' and source_id = v_mid and user_id = v_u) then
    raise exception '2 FALHOU: sem notificação de remoção.'; end if;
  if exists (select 1 from meeting_google_reconciliation where meeting_id = v_mid and status='pending') then raise exception '2 FALHOU: deixou pendência.'; end if;
  raise notice '2 OK: futura sem timer + cancel → excluída, notificada, sem fila.';

  -- 3 — futura com timer + cancel (enqueue) → mantém + marca + notifica
  select id into v_mid from meetings where google_event_id = 't79_m3';
  perform meeting_reconcile_enqueue(jsonb_build_array(jsonb_build_object('eventId','t79_m3','cancel',true)));
  if not exists (select 1 from meetings where id = v_mid) then raise exception '3 FALHOU: reunião com timer foi excluída.'; end if;
  if (select google_removed_at from meetings where id = v_mid) is null then raise exception '3 FALHOU: google_removed_at não marcado.'; end if;
  if not exists (select 1 from meeting_timers where meeting_id = v_mid) then raise exception '3 FALHOU: timer sumiu.'; end if;
  if not exists (select 1 from notifications where type='agenda_evento_apagado' and source_id = v_mid and user_id = v_u) then
    raise exception '3 FALHOU: sem notificação de mantida.'; end if;
  if exists (select 1 from meeting_google_reconciliation where meeting_id = v_mid and status='pending') then raise exception '3 FALHOU: deixou pendência.'; end if;
  raise notice '3 OK: futura com timer + cancel → mantida, marcada, notificada, sem fila.';

  -- 4 — futura nao_encontrada: 1ª varredura só marca; 2ª aplica
  select id into v_mid from meetings where google_event_id = 't79_m4';
  perform meeting_reconcile_enqueue(jsonb_build_array(jsonb_build_object('eventId','t79_m4','motivo','nao_encontrada')));
  if not exists (select 1 from meetings where id = v_mid) then raise exception '4 FALHOU: 1ª varredura excluiu.'; end if;
  if (select google_missing_at from meetings where id = v_mid) is null then raise exception '4 FALHOU: 1ª varredura não marcou missing.'; end if;
  if exists (select 1 from notifications where type='agenda_evento_apagado' and source_id = v_mid) then raise exception '4 FALHOU: 1ª varredura notificou cedo demais.'; end if;
  if exists (select 1 from meeting_google_reconciliation where meeting_id = v_mid and status='pending') then raise exception '4 FALHOU: 1ª varredura enfileirou.'; end if;
  -- 2ª varredura
  perform meeting_reconcile_enqueue(jsonb_build_array(jsonb_build_object('eventId','t79_m4','motivo','nao_encontrada')));
  if exists (select 1 from meetings where id = v_mid) then raise exception '4 FALHOU: 2ª varredura não aplicou (futura sem timer deveria excluir).'; end if;
  if not exists (select 1 from notifications where type='agenda_evento_apagado' and source_id = v_mid) then raise exception '4 FALHOU: 2ª varredura não notificou.'; end if;
  raise notice '4 OK: nao_encontrada futura → 1ª só marca; 2ª aplica (exclui + notifica).';

  -- 5 — 4 futuras canceladas no mesmo lote → todas na fila muitos_cancelamentos
  perform meeting_reconcile_enqueue(jsonb_build_array(
    jsonb_build_object('eventId','t79_m51','cancel',true),
    jsonb_build_object('eventId','t79_m52','cancel',true),
    jsonb_build_object('eventId','t79_m53','cancel',true),
    jsonb_build_object('eventId','t79_m54','cancel',true)));
  select count(*) into v_n from meeting_google_reconciliation r
    join meetings m on m.id = r.meeting_id
   where m.google_event_id like 't79_m5%' and r.status='pending' and r.motivo='muitos_cancelamentos';
  if v_n <> 4 then raise exception '5 FALHOU: esperava 4 muitos_cancelamentos, veio %.', v_n; end if;
  select count(*) into v_n from meetings where google_event_id like 't79_m5%';
  if v_n <> 4 then raise exception '5 FALHOU: reuniões futuras foram apagadas (teto deveria só enfileirar). Restam %.', v_n; end if;
  raise notice '5 OK: 4 futuras canceladas no lote → fila muitos_cancelamentos, reuniões intactas.';

  -- 6 — 4 passadas + 1 futura canceladas no mesmo lote
  perform meeting_reconcile_enqueue(jsonb_build_array(
    jsonb_build_object('eventId','t79_m6p1','cancel',true),
    jsonb_build_object('eventId','t79_m6p2','cancel',true),
    jsonb_build_object('eventId','t79_m6p3','cancel',true),
    jsonb_build_object('eventId','t79_m6p4','cancel',true),
    jsonb_build_object('eventId','t79_m6f','cancel',true)));
  -- passadas: marcadas removed, sem pendência, sem muitos_cancelamentos
  select count(*) into v_n from meetings where google_event_id like 't79_m6p%' and google_removed_at is not null;
  if v_n <> 4 then raise exception '6 FALHOU: esperava 4 passadas marcadas removed, veio %.', v_n; end if;
  if exists (select 1 from meeting_google_reconciliation r join meetings m on m.id=r.meeting_id
              where m.google_event_id like 't79_m6%' and r.status='pending') then
    raise exception '6 FALHOU: lote misto deixou pendência.'; end if;
  -- futura sem timer: aplicada (excluída) + notificada
  select id into v_mid from meetings where google_event_id = 't79_m6f';
  if v_mid is not null then raise exception '6 FALHOU: futura sem timer não foi excluída.'; end if;
  raise notice '6 OK: lote misto → 4 passadas resolvidas, futura aplicada, nada na fila.';

  -- 7 — apply reconciliado: futura sem timer + cancel → exclui + notifica
  select id into v_mid from meetings where google_event_id = 't79_m7';
  v_res := meetings_apply_google_sync(jsonb_build_array(jsonb_build_object('eventId','t79_m7','cancel',true)));
  if exists (select 1 from meetings where id = v_mid) then raise exception '7 FALHOU (apply): futura sem timer não excluída.'; end if;
  if coalesce((v_res->>'queued')::int,0) <> 0 then raise exception '7 FALHOU (apply): queued=% (esperava 0).', v_res; end if;
  if not exists (select 1 from notifications where type='agenda_evento_apagado' and source_id = v_mid) then raise exception '7 FALHOU (apply): sem notificação.'; end if;
  raise notice '7 OK (apply reconciliado): futura sem timer + cancel → excluída, notificada, sem fila.';

  -- 8 — passada + cancelado_google + COM timer → google_missing_at (NÃO removed),
  -- reunião e timer intactos, sem notificação, sem fila. (Portal: verificado abaixo.)
  select id into v_mid from meetings where google_event_id = 't79_m8';
  perform meeting_reconcile_enqueue(jsonb_build_array(jsonb_build_object('eventId','t79_m8','cancel',true)));
  if not exists (select 1 from meetings where id = v_mid) then raise exception '8 FALHOU: reunião com horas foi excluída.'; end if;
  if (select google_removed_at from meetings where id = v_mid) is not null then raise exception '8 FALHOU: marcou google_removed_at (tiraria do portal).'; end if;
  if (select google_missing_at from meetings where id = v_mid) is null then raise exception '8 FALHOU: não marcou google_missing_at.'; end if;
  if not exists (select 1 from meeting_timers where meeting_id = v_mid) then raise exception '8 FALHOU: timer sumiu.'; end if;
  if exists (select 1 from meeting_google_reconciliation where meeting_id = v_mid and status='pending') then raise exception '8 FALHOU: deixou pendência.'; end if;
  if exists (select 1 from notifications where type='agenda_evento_apagado' and source_id = v_mid) then raise exception '8 FALHOU: notificou (passada deveria ser silenciosa).'; end if;
  raise notice '8 OK: passada c/ horas cancelada no Google → missing (não removed), intacta, silenciosa.';

  raise notice 'TODOS OS CENÁRIOS 0179 OK.';
end $t$;

-- 8 (portal) — a reunião M8 (passada, com horas, marcada missing) ainda aparece
-- em client_portal_meetings_payload. A função é DEFINER e revogada de
-- authenticated; rodamos como o papel do dono (reset role) para chamá-la.
reset role;
do $p$
declare v_co uuid := '07489380-45d0-4484-9f29-189d85750881'; v_payload jsonb; v_found boolean;
begin
  v_payload := client_portal_meetings_payload(v_co, 50, 0);
  -- Casa por título (a serialização jsonb de timestamptz difere de ::text).
  select exists (
    select 1 from jsonb_array_elements(v_payload->'past'->'items') it
     where it->>'title' = 'M8 passada c/ horas'
  ) into v_found;
  if not v_found then
    raise exception '8 portal FALHOU: reunião passada com horas NÃO aparece no portal do cliente.';
  end if;
  raise notice '8 portal OK: reunião passada com horas segue visível em client_portal_meetings_payload.';
end $p$;

rollback;
