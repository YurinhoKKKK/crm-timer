-- =====================================================================
-- ROLLBACK da 0176 — volta ao estado pós-0175 (guarda por updated_at e
-- staleness do Aplicar por updated_at; reintroduz o bug que a 0176 corrige).
-- =====================================================================

drop trigger if exists trg_meetings_stamp_pushed on meetings;
drop function if exists meetings_stamp_pushed();

-- meetings_set_sync volta à 0175 (sem o carimbo).
create or replace function meetings_set_sync(
  p_meeting   uuid,
  p_status    text,
  p_error     text,
  p_has_event boolean default false,
  p_event_id  text default null,
  p_meet_link text default null,
  p_email     text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_creator uuid;
  v_my_email text;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if p_status not in ('pendente', 'sincronizado', 'nao_conectado', 'falhou') then
    raise exception 'status de sincronização inválido (%).', coalesce(p_status, 'nulo');
  end if;

  select created_by into v_creator from meetings where id = p_meeting;
  if not found then return; end if;
  if v_creator <> v_user then
    raise exception 'Só quem criou a reunião grava o resultado da sincronização.'
      using errcode = '42501';
  end if;

  if p_has_event then
    if p_email is not null then
      select google_email into v_my_email from google_accounts where user_id = v_user;
      if v_my_email is distinct from p_email then
        raise exception 'A conta Google informada não é a conta conectada deste usuário.'
          using errcode = '42501';
      end if;
    end if;
    update meetings
       set google_sync_status = p_status,
           google_sync_error  = p_error,
           google_event_id    = nullif(p_event_id, ''),
           google_calendar_id = 'primary',
           meet_link          = p_meet_link,
           google_email       = p_email,
           google_removed_at  = null,
           google_missing_at  = null,
           updated_at         = now()
     where id = p_meeting;
  else
    update meetings
       set google_sync_status = p_status,
           google_sync_error  = p_error,
           updated_at         = now()
     where id = p_meeting;
  end if;
end;
$$;

-- meetings_apply_google_sync volta à versão pós-0175 (guarda por updated_at nos
-- dois ramos; demais travas iguais).
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
        select m.id, m.title, m.starts_at, m.ends_at, m.updated_at,
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
        if v_upd is not null and v_upd <= v_cur.updated_at then continue; end if;
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
      select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.updated_at,
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
      if v_upd is not null and v_upd <= v_cur.updated_at then continue; end if;
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
           = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
        continue;
      end if;

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

-- meeting_reconcile_apply volta à 0174 (staleness por updated_at).
create or replace function meeting_reconcile_apply(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row meeting_google_reconciliation%rowtype; v_m record;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem aplicar a reconciliação.' using errcode = '42501';
  end if;
  select * into v_row from meeting_google_reconciliation where id = p_id;
  if not found then raise exception 'Linha de reconciliação não encontrada.'; end if;
  if v_row.status <> 'pending' then raise exception 'Esta linha já foi resolvida.'; end if;
  if v_row.meeting_id is null then raise exception 'A reunião desta linha não existe mais.'; end if;
  if v_row.proposed_action = 'revisar' then
    raise exception 'Esta linha é só para revisão (%): não há mudança automática a aplicar. Use Dispensar após resolver.', coalesce(v_row.motivo, 'revisar');
  end if;

  select updated_at into v_m from meetings where id = v_row.meeting_id;
  if v_m.updated_at > v_row.detected_at then
    raise exception 'A reunião mudou no CRM depois desta detecção. Rode uma nova varredura antes de aplicar.';
  end if;

  perform set_config('app.meeting_event_applied_by', auth.uid()::text, true);

  if v_row.proposed_action = 'update' then
    if v_row.google_starts_at is null or v_row.google_ends_at is null
       or v_row.google_ends_at <= v_row.google_starts_at then
      raise exception 'Horário do Google inválido nesta linha: não é aplicável.';
    end if;
    perform _apply_meeting_google_change(v_row.meeting_id, v_row.google_title,
      v_row.google_starts_at, v_row.google_ends_at, v_row.google_meet_link, false);
  else
    perform _apply_meeting_google_change(v_row.meeting_id, null, null, null, null, true);
  end if;

  update meeting_google_reconciliation
     set status = 'applied', resolved_at = now(), resolved_by = auth.uid()
   where id = p_id;
end;
$$;

alter table meetings drop column if exists google_pushed_at;
