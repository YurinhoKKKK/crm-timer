-- =====================================================================
-- ROLLBACK da 0174 — volta ao estado pós-0173.
--   · funções voltam às versões 0172/0173 (apply/enqueue/apply_sync/list/trigger);
--   · schedule_conflicts volta à 0050; portal payload volta sem o filtro;
--   · dropa helpers novos, trigger de notificação e agenda_sync_status;
--   · dropa colunas novas (google_email, google_missing_at, motivo).
-- Notificações já emitidas (reuniao_fora_google / agenda_conta_diferente) são
-- DADOS e não são apagadas. Linhas 'revisar' da fila são removidas (o constraint
-- antigo não as aceita).
-- =====================================================================

drop trigger if exists trg_meetings_sync_pending_notify on meetings;
drop function if exists meetings_sync_pending_notify();

-- Seção 14: gatilho de preenchimento de google_email (a coluna cai no fim).
drop trigger if exists trg_meetings_fill_google_email on meetings;
drop function if exists meetings_fill_google_email();

-- Seção 18: roster da reconciliação é novo da 0174.
drop function if exists meeting_reconcile_owners();

-- Seção 17: finalize volta à versão 0172 (sem a trava de frescor).
create or replace function meeting_reconcile_finalize(p_owner uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem concluir a reconciliação.' using errcode = '42501';
  end if;
  insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
  values (p_owner, now(), now())
  on conflict (user_id) do update set auto_apply_from = now(), updated_at = now();
end;
$$;
revoke execute on function meeting_reconcile_finalize(uuid) from public, anon;
grant  execute on function meeting_reconcile_finalize(uuid) to authenticated;

-- Seção 16: detach volta à versão 0147 (sem o guard de empresa em exclusão).
create or replace function meetings_timer_detach()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update meeting_timers set origin_deleted_at = now()
   where meeting_id = old.id and origin_deleted_at is null;
  return old;
end; $$;

-- Seção 15: convite volta à versão 0077 (sem dedupe).
create or replace function notify_meeting_invite()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_company uuid; v_title text; v_created_by uuid; v_actor uuid;
begin
  select company_id, title, created_by
  into v_company, v_title, v_created_by
  from meetings where id = new.meeting_id;
  if new.user_id = v_created_by then return null; end if;
  v_actor := coalesce(auth.uid(), v_created_by);
  perform push_notification(
    new.user_id, 'reuniao_convite', 'Convidou você para uma reunião', v_title,
    v_company, 'meeting', new.meeting_id, v_actor
  );
  return null;
end;
$$;

-- CHECK de notifications.type volta ao domínio anterior (remove antes as
-- notificações dos tipos novos — o constraint antigo não as aceita).
delete from notifications where type in ('reuniao_fora_google', 'agenda_conta_diferente');
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type = any (array['mencionado','resposta_recebida','tarefa_atribuida',
    'tarefa_recorrente_atribuida','listagem_ajuste_solicitado','reuniao_convite',
    'reuniao_cancelada','empresa_onboarding','empresa_renovacao','digisac_sync_auth',
    'digisac_sync_error','digisac_sync_stalled','reuniao_em_andamento',
    'reuniao_encerrada_auto']));
drop function if exists agenda_sync_status();
drop function if exists _mgr_notify_conta_diferente(uuid, uuid, text);
drop function if exists _mgr_upsert(uuid, uuid, jsonb, text);
drop function if exists _mgr_safe_ts(text);

-- Fila: remove linhas 'revisar' e a coluna motivo; constraint volta ao domínio 0172.
delete from meeting_google_reconciliation where proposed_action = 'revisar';
alter table meeting_google_reconciliation
  drop constraint meeting_google_reconciliation_proposed_action_check;
alter table meeting_google_reconciliation
  add constraint meeting_google_reconciliation_proposed_action_check
  check (proposed_action in ('update', 'cancel_delete', 'cancel_keep'));
alter table meeting_google_reconciliation drop column if exists motivo;

-- Gatilho de histórico — versão 0172 (AFTER insert/update/delete, details simples).
drop trigger if exists trg_meetings_event_delete on meetings;
create or replace function meetings_event_trg()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_origin  text := coalesce(current_setting('app.meeting_event_origin', true), 'crm');
  v_actor   uuid := case when v_origin = 'google' then null else auth.uid() end;
  v_when    text;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    if new.company_id is null then return null; end if;
    v_when := to_char(new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'reuniao_criada',
            'Reunião “' || coalesce(new.title, '(sem título)') || '” criada para ' || v_when,
            jsonb_build_object('meetingId', new.id, 'startsAt', new.starts_at,
                               'meetingType', new.meeting_type, 'room', new.room,
                               'origem', v_origin),
            auth.uid());
    return null;
  elsif tg_op = 'UPDATE' then
    if new.company_id is null then return null; end if;
    if new.title is not distinct from old.title
       and new.starts_at is not distinct from old.starts_at
       and new.ends_at is not distinct from old.ends_at then
      return null;
    end if;
    v_changes := jsonb_build_object('meetingId', new.id, 'origem', v_origin);
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('tituloDe', old.title, 'tituloPara', new.title);
    end if;
    if new.starts_at is distinct from old.starts_at then
      v_changes := v_changes || jsonb_build_object('inicioDe', old.starts_at, 'inicioPara', new.starts_at);
    end if;
    if new.ends_at is distinct from old.ends_at then
      v_changes := v_changes || jsonb_build_object('fimDe', old.ends_at, 'fimPara', new.ends_at);
    end if;
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'reuniao_editada',
            'Reunião “' || coalesce(new.title, '(sem título)') || '” alterada'
              || case when v_origin = 'google' then ' (via Google)' else '' end,
            v_changes, v_actor);
    return null;
  else
    if old.company_id is null then return null; end if;
    v_when := to_char(old.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'reuniao_cancelada',
            'Reunião “' || coalesce(old.title, '(sem título)') || '” (' || v_when || ') cancelada'
              || case when v_origin = 'google' then ' (removida no Google)' else '' end,
            jsonb_build_object('meetingId', old.id, 'startsAt', old.starts_at,
                               'meetingType', old.meeting_type, 'room', old.room,
                               'origem', v_origin),
            v_actor);
    return null;
  end if;
end;
$$;
drop trigger if exists trg_meetings_event on meetings;
create trigger trg_meetings_event
  after insert or update or delete on meetings
  for each row execute function meetings_event_trg();

-- Núcleo — versão 0172 (+ revoke da 0173).
create or replace function _apply_meeting_google_change(
  p_meeting uuid, p_title text, p_starts timestamptz, p_ends timestamptz,
  p_meet text, p_cancel boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_has_timer boolean; v_company uuid; v_title text;
begin
  perform set_config('app.meeting_event_origin', 'google', true);
  if p_cancel then
    select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_has_timer;
    if v_has_timer then
      select company_id, title into v_company, v_title from meetings where id = p_meeting;
      update meetings set google_removed_at = now(), updated_at = now()
       where id = p_meeting and google_removed_at is null;
      perform log_company_event(v_company, 'reuniao_cancelada',
        'Reunião “' || coalesce(v_title, '(sem título)')
          || '” foi removida no Google; mantida no CRM por ter horas registradas',
        jsonb_build_object('meetingId', p_meeting, 'origem', 'google', 'mantida', true),
        null, 'google_removed', p_meeting::text);
    else
      delete from meetings where id = p_meeting;
    end if;
  else
    update meetings set title = p_title, starts_at = p_starts, ends_at = p_ends,
       meet_link = coalesce(p_meet, meet_link), updated_at = now() where id = p_meeting;
  end if;
end;
$$;
revoke all on function _apply_meeting_google_change(uuid, text, timestamptz, timestamptz, text, boolean) from public, anon, authenticated;

-- Auto-sync — versão 0172.
create or replace function meetings_apply_google_sync(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_trusted boolean; v_op jsonb; v_cur record;
  v_upd timestamptz; v_applied int := 0;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select auto_apply_from is not null into v_trusted
    from google_calendar_import_state where user_id = v_user;
  if not coalesce(v_trusted, false) then
    return jsonb_build_object('applied', 0, 'trusted', false);
  end if;
  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.updated_at into v_cur
      from meetings m
     where m.created_by = v_user and m.google_event_id = (v_op->>'eventId')
       and m.google_removed_at is null limit 1;
    if not found then continue; end if;
    if coalesce((v_op->>'cancel')::boolean, false) then
      perform _apply_meeting_google_change(v_cur.id, null, null, null, null, true);
      v_applied := v_applied + 1; continue;
    end if;
    v_upd := nullif(v_op->>'updated', '')::timestamptz;
    if v_upd is not null and v_upd <= v_cur.updated_at then continue; end if;
    if coalesce(v_op->>'title', '') = coalesce(v_cur.title, '')
       and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
       and (v_op->>'endsAt')::timestamptz = v_cur.ends_at
       and coalesce(v_op->>'meetLink', '') = coalesce(v_cur.meet_link, '') then
      continue;
    end if;
    perform _apply_meeting_google_change(v_cur.id, v_op->>'title',
      (v_op->>'startsAt')::timestamptz, (v_op->>'endsAt')::timestamptz,
      nullif(v_op->>'meetLink', ''), false);
    v_applied := v_applied + 1;
  end loop;
  return jsonb_build_object('applied', v_applied, 'trusted', true);
end;
$$;
revoke execute on function meetings_apply_google_sync(jsonb) from public, anon, authenticated;
grant  execute on function meetings_apply_google_sync(jsonb) to authenticated;

-- Enqueue — versão 0172.
create or replace function meeting_reconcile_enqueue(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_op jsonb; v_cur record; v_timer boolean;
  v_action text; v_cancel boolean; v_gtitle text; v_gstart timestamptz;
  v_gend timestamptz; v_gmeet text; v_count int := 0;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    select m.id, m.company_id, m.title, m.starts_at, m.ends_at, m.meet_link into v_cur
      from meetings m
     where m.created_by = v_user and m.google_event_id = (v_op->>'eventId')
       and m.google_removed_at is null limit 1;
    if not found then continue; end if;
    v_cancel := coalesce((v_op->>'cancel')::boolean, false);
    v_gtitle := v_op->>'title'; v_gstart := nullif(v_op->>'startsAt', '')::timestamptz;
    v_gend := nullif(v_op->>'endsAt', '')::timestamptz; v_gmeet := nullif(v_op->>'meetLink', '');
    if not v_cancel and coalesce(v_gtitle, '') = coalesce(v_cur.title, '')
       and v_gstart = v_cur.starts_at and v_gend = v_cur.ends_at then continue; end if;
    select exists (select 1 from meeting_timers t where t.meeting_id = v_cur.id) into v_timer;
    v_action := case when not v_cancel then 'update'
                     when v_timer then 'cancel_keep' else 'cancel_delete' end;
    insert into meeting_google_reconciliation
      (meeting_id, owner_id, company_id, proposed_action,
       crm_title, crm_starts_at, crm_ends_at, crm_meet_link,
       google_title, google_starts_at, google_ends_at, google_meet_link,
       google_event_id, google_updated_at, has_timer, status, detected_at)
    values (v_cur.id, v_user, v_cur.company_id, v_action,
       v_cur.title, v_cur.starts_at, v_cur.ends_at, v_cur.meet_link,
       v_gtitle, v_gstart, v_gend, v_gmeet,
       v_op->>'eventId', nullif(v_op->>'updated', '')::timestamptz, v_timer, 'pending', now())
    on conflict (meeting_id) do update set
       owner_id = excluded.owner_id, company_id = excluded.company_id,
       proposed_action = excluded.proposed_action,
       crm_title = excluded.crm_title, crm_starts_at = excluded.crm_starts_at,
       crm_ends_at = excluded.crm_ends_at, crm_meet_link = excluded.crm_meet_link,
       google_title = excluded.google_title, google_starts_at = excluded.google_starts_at,
       google_ends_at = excluded.google_ends_at, google_meet_link = excluded.google_meet_link,
       google_event_id = excluded.google_event_id, google_updated_at = excluded.google_updated_at,
       has_timer = excluded.has_timer, status = 'pending', detected_at = now(),
       resolved_at = null, resolved_by = null;
    v_count := v_count + 1;
  end loop;
  update google_calendar_import_state set last_reconcile_scan_at = now() where user_id = v_user;
  return jsonb_build_object('enqueued', v_count);
end;
$$;
revoke execute on function meeting_reconcile_enqueue(jsonb) from public, anon, authenticated;
grant  execute on function meeting_reconcile_enqueue(jsonb) to authenticated;

-- Apply — versão 0172.
create or replace function meeting_reconcile_apply(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row meeting_google_reconciliation%rowtype;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem aplicar a reconciliação.' using errcode = '42501';
  end if;
  select * into v_row from meeting_google_reconciliation where id = p_id;
  if not found then raise exception 'Linha de reconciliação não encontrada.'; end if;
  if v_row.status <> 'pending' then raise exception 'Esta linha já foi resolvida.'; end if;
  if v_row.meeting_id is null then raise exception 'A reunião desta linha não existe mais.'; end if;
  if v_row.proposed_action = 'update' then
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
revoke execute on function meeting_reconcile_apply(uuid) from public, anon, authenticated;
grant  execute on function meeting_reconcile_apply(uuid) to authenticated;

-- List — versão 0172 (sem motivo).
drop function if exists meeting_reconcile_list();
create or replace function meeting_reconcile_list()
returns table (
  id uuid, meeting_id uuid, owner_id uuid, owner_name text,
  company_id uuid, company_name text, proposed_action text,
  crm_title text, crm_starts_at timestamptz, crm_ends_at timestamptz, crm_meet_link text,
  google_title text, google_starts_at timestamptz, google_ends_at timestamptz, google_meet_link text,
  has_timer boolean, google_updated_at timestamptz, detected_at timestamptz,
  owner_auto_apply_from timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.meeting_id, r.owner_id, p.full_name,
         r.company_id, c.name, r.proposed_action,
         r.crm_title, r.crm_starts_at, r.crm_ends_at, r.crm_meet_link,
         r.google_title, r.google_starts_at, r.google_ends_at, r.google_meet_link,
         r.has_timer, r.google_updated_at, r.detected_at,
         s.auto_apply_from
    from meeting_google_reconciliation r
    left join profiles p on p.id = r.owner_id
    left join companies c on c.id = r.company_id
    left join google_calendar_import_state s on s.user_id = r.owner_id
   where (select is_admin()) and r.status = 'pending'
   order by p.full_name nulls last, r.google_starts_at nulls last;
$$;
revoke execute on function meeting_reconcile_list() from public, anon, authenticated;
grant  execute on function meeting_reconcile_list() to authenticated;

-- schedule_conflicts — versão 0050 (grants: authenticated).
create or replace function schedule_conflicts(
  p_starts timestamptz, p_ends timestamptz, p_user_ids uuid[], p_exclude uuid default null
)
returns table (
  source text, ref_id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  company_name text, conflicting_user_ids uuid[]
)
language sql stable security definer set search_path = public as $$
  select 'sistema'::text, m.id, m.title, m.starts_at, m.ends_at, c.name,
         array_agg(distinct cu.uid order by cu.uid)
  from meetings m
  join companies c on c.id = m.company_id
  join lateral (
    select u.uid from unnest(p_user_ids) as u(uid)
    where m.created_by = u.uid
       or exists (select 1 from meeting_participants mp
                   where mp.meeting_id = m.id and mp.user_id = u.uid)
  ) cu on true
  where m.starts_at < p_ends and m.ends_at > p_starts
    and (p_exclude is null or m.id <> p_exclude)
  group by m.id, m.title, m.starts_at, m.ends_at, c.name
  union all
  select 'google'::text, e.id,
         case when e.is_private and e.user_id <> auth.uid() then null else e.title end,
         e.starts_at, e.ends_at, null::text, array[e.user_id]
  from imported_google_events e
  where e.user_id = any(p_user_ids) and e.starts_at < p_ends and e.ends_at > p_starts
  order by 4;
$$;
revoke execute on function schedule_conflicts(timestamptz, timestamptz, uuid[], uuid) from public, anon, authenticated;
grant  execute on function schedule_conflicts(timestamptz, timestamptz, uuid[], uuid) to authenticated;

-- Portal payload — versão anterior (sem o filtro google_removed_at).
create or replace function client_portal_meetings_payload(p_company uuid, p_limit integer, p_offset integer)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_past_total bigint; v_upcoming jsonb; v_past jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', up.title, 'starts_at', up.starts_at, 'ends_at', up.ends_at,
           'type', up.meeting_type,
           'meet_link', case when up.meeting_type = 'meet' then up.meet_link else null end
         ) order by up.starts_at asc, up.id), '[]'::jsonb)
    into v_upcoming
    from (select m.id, m.title, m.starts_at, m.ends_at, m.meeting_type, m.meet_link
            from meetings m
           where m.company_id = p_company and not m.client_hidden and m.ends_at > now()
           order by m.starts_at asc, m.id limit 100) up;
  select count(*) into v_past_total
    from meetings m
   where m.company_id = p_company and not m.client_hidden and m.ends_at <= now();
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', pg.title, 'starts_at', pg.starts_at, 'ends_at', pg.ends_at,
           'type', pg.meeting_type
         ) order by pg.starts_at desc, pg.id), '[]'::jsonb)
    into v_past
    from (select m.id, m.title, m.starts_at, m.ends_at, m.meeting_type
            from meetings m
           where m.company_id = p_company and not m.client_hidden and m.ends_at <= now()
           order by m.starts_at desc, m.id limit v_limit offset v_offset) pg;
  return jsonb_build_object('upcoming', v_upcoming,
    'past', jsonb_build_object('total', v_past_total, 'items', v_past));
end;
$$;
revoke all on function client_portal_meetings_payload(uuid, integer, integer) from public, anon, authenticated;

-- Colunas novas de meetings.
alter table meetings drop column if exists google_email;
alter table meetings drop column if exists google_missing_at;
