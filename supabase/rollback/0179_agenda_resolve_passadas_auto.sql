-- =====================================================================
-- REVERSÃO da 0179 — volta ao estado 0178 (enqueue → 0174; apply → 0178).
-- =====================================================================
-- Restaura meeting_reconcile_enqueue (versão 0174) e meetings_apply_google_sync
-- (versão 0178), remove os helpers novos e o tipo de notificação novo.
--
-- ATENÇÃO (dados, não revertidos — decisão "nada é apagado"):
--  · os itens fechados pela limpeza da 0179 ficam status 'superado' +
--    resolution_reason 'reuniao_passada' (status 'superado' segue válido no CHECK
--    da 0178, então nada a fazer);
--  · as reuniões marcadas (google_missing_at / google_removed_at) permanecem;
--  · as notificações 'agenda_evento_apagado' são APAGADAS para o ALTER do CHECK
--    não falhar (são informativas; é a única forma de restaurar o CHECK antigo).
-- =====================================================================

-- 1. Remove os helpers novos.
drop function if exists _mgr_future_gone_apply(uuid, uuid, text);
drop function if exists _mgr_notify_evento_apagado(uuid, uuid, text, boolean);
drop function if exists _mgr_resolve_past_gone(uuid, text);

-- 2. meeting_reconcile_enqueue volta à 0174 §8.
create or replace function meeting_reconcile_enqueue(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_op    jsonb;
  v_cur   record;
  v_motivo text;
  v_count int := 0;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select google_email into v_email from google_accounts where user_id = v_user;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin
      select m.id, m.title, m.starts_at, m.ends_at, m.google_email, m.google_sync_status
        into v_cur
        from meetings m
       where m.created_by = v_user
         and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null
       limit 1;
      if not found then continue; end if;

      v_motivo := nullif(v_op->>'motivo', '');

      if v_motivo is distinct from 'conta_diferente'
         and (v_cur.google_email is null or v_email is null
              or v_cur.google_email <> v_email) then
        v_motivo := 'conta_diferente';
      end if;
      if v_motivo = 'conta_diferente' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_count := v_count + 1;
        continue;
      end if;

      if v_motivo is not null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        v_count := v_count + 1;
        continue;
      end if;

      update meetings set google_missing_at = null
       where id = v_cur.id and google_missing_at is not null;

      if coalesce((v_op->>'cancel')::boolean, false) then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'cancelado_google');
        v_count := v_count + 1;
        continue;
      end if;
      if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario');
        v_count := v_count + 1; continue;
      end if;
      if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido');
        v_count := v_count + 1; continue;
      end if;
      if v_cur.google_sync_status <> 'sincronizado' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente');
        v_count := v_count + 1; continue;
      end if;

      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
           = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
        continue;
      end if;

      perform _mgr_upsert(v_cur.id, v_user, v_op, null);
      v_count := v_count + 1;
    exception when others then
      null;
    end;
  end loop;

  update google_calendar_import_state set last_reconcile_scan_at = now() where user_id = v_user;
  return jsonb_build_object('enqueued', v_count);
end;
$$;
revoke execute on function meeting_reconcile_enqueue(jsonb) from public, anon, authenticated;
grant  execute on function meeting_reconcile_enqueue(jsonb) to authenticated;

-- 3. meetings_apply_google_sync volta à 0178 §4.
create or replace function meetings_apply_google_sync(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_email   text;
  v_trusted boolean;
  v_op      jsonb;
  v_cur     record;
  v_upd     timestamptz;
  v_motivo  text;
  v_applied int := 0;
  v_queued  int := 0;
  v_cancels jsonb[] := '{}';
  c         jsonb;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;

  select auto_apply_from is not null into v_trusted
    from google_calendar_import_state where user_id = v_user;
  select google_email into v_email from google_accounts where user_id = v_user;

  if not coalesce(v_trusted, false) then
    for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
      begin
        select m.id, m.title, m.starts_at, m.ends_at, m.google_pushed_at,
               m.google_email, m.google_sync_status
          into v_cur
          from meetings m
         where m.created_by = v_user
           and m.google_event_id = (v_op->>'eventId')
           and m.google_removed_at is null
         limit 1;
        if not found then continue; end if;

        v_motivo := nullif(v_op->>'motivo', '');
        if v_motivo is distinct from 'conta_diferente'
           and (v_cur.google_email is null or v_email is null
                or v_cur.google_email <> v_email) then
          v_motivo := 'conta_diferente';
        end if;
        if v_motivo = 'conta_diferente' then
          perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
          perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
          v_queued := v_queued + 1;
          continue;
        end if;
        if v_motivo is not null then
          perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
          v_queued := v_queued + 1;
          continue;
        end if;
        if coalesce((v_op->>'cancel')::boolean, false) then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'cancelado_google');
          v_queued := v_queued + 1;
          continue;
        end if;
        if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario');
          v_queued := v_queued + 1; continue;
        end if;
        if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido');
          v_queued := v_queued + 1; continue;
        end if;
        if v_cur.google_sync_status <> 'sincronizado' then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente');
          v_queued := v_queued + 1; continue;
        end if;
        v_upd := nullif(v_op->>'updated', '')::timestamptz;
        if v_upd is not null and v_cur.google_pushed_at is not null
           and v_upd <= v_cur.google_pushed_at then
          continue;
        end if;
        if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
             = coalesce(v_cur.title, '')
           and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
           and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
          continue;
        end if;
        perform _mgr_upsert(v_cur.id, v_user, v_op, null);
        v_queued := v_queued + 1;
      exception when others then
        begin
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'erro_interno');
          v_queued := v_queued + 1;
        exception when others then null;
        end;
      end;
    end loop;
    return jsonb_build_object('applied', 0, 'queued', v_queued, 'trusted', false);
  end if;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin
      select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.google_pushed_at,
             m.google_email, m.google_sync_status
        into v_cur
        from meetings m
       where m.created_by = v_user
         and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null
       limit 1;
      if not found then continue; end if;

      v_motivo := nullif(v_op->>'motivo', '');
      if v_motivo is not null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        v_queued := v_queued + 1;
        continue;
      end if;

      if v_cur.google_email is null or v_email is null
         or v_cur.google_email <> v_email then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'conta_diferente');
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_queued := v_queued + 1;
        continue;
      end if;

      if coalesce((v_op->>'cancel')::boolean, false) then
        v_cancels := v_cancels || v_op;
        continue;
      end if;

      if v_cur.google_sync_status <> 'sincronizado' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente');
        v_queued := v_queued + 1;
        continue;
      end if;

      if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario');
        v_queued := v_queued + 1; continue;
      end if;
      if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido');
        v_queued := v_queued + 1; continue;
      end if;

      v_upd := nullif(v_op->>'updated', '')::timestamptz;
      if v_upd is not null and v_cur.google_pushed_at is not null
         and v_upd <= v_cur.google_pushed_at then
        continue;
      end if;
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
           = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
        continue;
      end if;

      perform _mgr_close_superseded(v_cur.id, 'aplicado_automaticamente');
      perform _apply_meeting_google_change(
        v_cur.id, v_op->>'title',
        (v_op->>'startsAt')::timestamptz, (v_op->>'endsAt')::timestamptz,
        nullif(v_op->>'meetLink', ''), false);
      v_applied := v_applied + 1;
    exception when others then
      begin
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'erro_interno');
        v_queued := v_queued + 1;
      exception when others then null;
      end;
    end;
  end loop;

  if coalesce(array_length(v_cancels, 1), 0) > 3 then
    foreach c in array v_cancels loop
      begin
        select m.id into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (c->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _mgr_upsert(v_cur.id, v_user, c, 'muitos_cancelamentos');
          v_queued := v_queued + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  else
    foreach c in array v_cancels loop
      begin
        select m.id into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (c->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _mgr_close_superseded(v_cur.id, 'aplicado_automaticamente');
          perform _apply_meeting_google_change(v_cur.id, null, null, null, null, true);
          v_applied := v_applied + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  end if;

  return jsonb_build_object('applied', v_applied, 'queued', v_queued, 'trusted', true);
end;
$$;
revoke execute on function meetings_apply_google_sync(jsonb) from public, anon, authenticated;
grant  execute on function meetings_apply_google_sync(jsonb) to authenticated;

-- 4. Comentário do resolution_reason volta ao texto da 0178.
comment on column meeting_google_reconciliation.resolution_reason is
  'Por que a linha SAIU da fila por encerramento automático (0178): aplicado_automaticamente (auto-sync aplicou a mudança sozinho) ou reuniao_excluida (reunião apagada). null quando resolvida pelo admin (applied/dismissed) ou ainda pendente. A coluna motivo (0174) guarda por que ENTROU.';

-- 5. Remove o tipo de notificação novo (apaga as informativas antes do CHECK).
delete from notifications where type = 'agenda_evento_apagado';
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type = any (array['mencionado','resposta_recebida','tarefa_atribuida',
    'tarefa_recorrente_atribuida','listagem_ajuste_solicitado','reuniao_convite',
    'reuniao_cancelada','empresa_onboarding','empresa_renovacao','digisac_sync_auth',
    'digisac_sync_error','digisac_sync_stalled','reuniao_em_andamento',
    'reuniao_encerrada_auto','reuniao_fora_google','agenda_conta_diferente']));
