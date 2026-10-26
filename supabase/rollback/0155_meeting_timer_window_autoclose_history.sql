-- =====================================================================
-- ROLLBACK da 0155 — restaura o estado 0148/0149.
-- =====================================================================
-- Volta a trava "Play só 30 min antes" (meeting_play_allowed + checagem em
-- start/resume), o cron de +3h/+4h (sem +5h e sem limite de 12h), o histórico
-- some (drop meeting_timer_audit_list; policy mta_select volta ao admin/dono/
-- editor) e a coluna `edited` de readable_meeting_timers.
-- OBS.: eventos 'auto_close' (edited_by NULL) gravados pela 0155 são APAGADOS —
-- não existem no formato anterior; o novo cron voltaria a não gravar auditoria.
-- =====================================================================

-- 1) Janela de Play (0148).
create or replace function meeting_play_allowed(p_sstart timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_sstart is null or now() >= (p_sstart - interval '30 minutes');
$$;
revoke execute on function meeting_play_allowed(timestamptz) from public, anon;

-- 2) start/resume (0148) — com a trava de 30 min.
create or replace function meeting_timer_start(
  p_meeting_id      uuid default null,
  p_google_event_id text default null,
  p_company_id      uuid default null,
  p_people          uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_company  uuid;
  v_title    text;
  v_sstart   timestamptz;
  v_send     timestamptz;
  v_creator  uuid;
  v_existing meeting_timers%rowtype;
  v_timer    uuid;
  v_open_at  timestamptz;
  v_started  timestamptz;
  v_resumed  boolean := false;
  v_pre      jsonb;
  v_person   uuid;
begin
  if v_user is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  if num_nonnulls(p_meeting_id, p_google_event_id) <> 1 then
    raise exception 'Informe exatamente uma origem: reunião do CRM ou evento do Google.';
  end if;

  if p_meeting_id is not null then
    select company_id, title, starts_at, ends_at, created_by
      into v_company, v_title, v_sstart, v_send, v_creator
      from meetings where id = p_meeting_id;
    if not found then raise exception 'Reunião não encontrada.'; end if;
    if v_creator is distinct from v_user then
      raise exception 'Só quem criou a reunião no CRM pode iniciar o timer.' using errcode = '42501';
    end if;
  else
    if exists (select 1 from meetings m where m.google_event_id = p_google_event_id) then
      raise exception 'Esta reunião foi criada pelo CRM. Use o timer da reunião.' using errcode = '42501';
    end if;
    select title, starts_at, ends_at
      into v_title, v_sstart, v_send
      from imported_google_events
     where user_id = v_user and google_event_id = p_google_event_id
     order by updated_at desc limit 1;
    if not found then
      raise exception 'Só quem tem o evento na própria agenda do Google pode iniciar o timer.' using errcode = '42501';
    end if;
    if exists (select 1 from imported_google_events
                where user_id = v_user and google_event_id = p_google_event_id and is_private) then
      raise exception 'Eventos particulares não podem ser cronometrados.' using errcode = '42501';
    end if;
  end if;

  if p_meeting_id is not null then
    select * into v_existing from meeting_timers where meeting_id = p_meeting_id;
  else
    select * into v_existing from meeting_timers where google_event_id = p_google_event_id;
  end if;

  if found then
    if v_existing.started_by is distinct from v_user then
      raise exception 'Esta reunião já tem um timer iniciado por outra pessoa.' using errcode = '42501';
    end if;
    if v_existing.finalized_at is not null then
      raise exception 'Esta reunião foi finalizada. Não é possível retomar o timer.' using errcode = '42501';
    end if;
    v_timer  := v_existing.id;
    v_sstart := v_existing.scheduled_start;
    select started_at into v_open_at
      from meeting_timer_segments where timer_id = v_timer and ended_at is null
      order by started_at desc limit 1;
    if v_open_at is not null then
      return jsonb_build_object('timer_id', v_timer, 'started_at', v_open_at,
                                'already_running', true, 'resumed', false);
    end if;
    v_resumed := true;
  end if;

  if v_timer is null and p_google_event_id is not null then
    if p_company_id is null then raise exception 'Escolha a empresa da reunião.'; end if;
    if not ((select is_admin()) or p_company_id in (select my_consultant_companies())) then
      raise exception 'Empresa fora do seu alcance.' using errcode = '42501';
    end if;
    v_company := p_company_id;
  end if;

  if not meeting_play_allowed(v_sstart) then
    raise exception 'O timer só pode começar a partir de 30 min antes do início da reunião (%).',
      to_char((v_sstart - interval '30 minutes') at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;

  v_pre := meeting_timer_preempt();

  if v_timer is null then
    insert into meeting_timers
      (company_id, meeting_id, google_event_id, title, scheduled_start, scheduled_end, started_by)
    values
      (v_company, p_meeting_id, p_google_event_id, v_title, v_sstart, v_send, v_user)
    returning id into v_timer;

    if p_meeting_id is not null then
      insert into meeting_timer_people (timer_id, user_id)
      select v_timer, v_user
      union
      select v_timer, mp.user_id from meeting_participants mp where mp.meeting_id = p_meeting_id
      on conflict do nothing;
    else
      insert into meeting_timer_people (timer_id, user_id) values (v_timer, v_user)
      on conflict do nothing;
      if p_people is not null then
        foreach v_person in array p_people loop
          if v_person is not null and v_person <> v_user then
            if not is_internal_user(v_person) then
              raise exception 'Participante inválido (não é usuário interno ativo).' using errcode = '22023';
            end if;
            insert into meeting_timer_people (timer_id, user_id) values (v_timer, v_person)
            on conflict do nothing;
          end if;
        end loop;
      end if;
    end if;
  else
    update meeting_timers set manual_seconds = null where id = v_timer;
  end if;

  insert into meeting_timer_segments (timer_id, started_at) values (v_timer, now())
  returning started_at into v_started;

  return jsonb_build_object(
    'timer_id', v_timer, 'started_at', v_started, 'resumed', v_resumed,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title'
  );
end;
$$;

create or replace function meeting_timer_resume(p_timer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_started timestamptz; v_pre jsonb;
  v_sstart timestamptz; v_fin timestamptz; v_found boolean;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select true, started_by, scheduled_start, finalized_at
    into v_found, v_owner, v_sstart, v_fin
    from meeting_timers where id = p_timer;
  if v_found is null then raise exception 'Timer não encontrado.'; end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode retomar o timer da reunião.' using errcode = '42501';
  end if;
  if v_fin is not null then
    raise exception 'Esta reunião foi finalizada. Não é possível retomar o timer.' using errcode = '42501';
  end if;
  select started_at into v_started from meeting_timer_segments
   where timer_id = p_timer and ended_at is null order by started_at desc limit 1;
  if v_started is not null then
    return jsonb_build_object('timer_id', p_timer, 'started_at', v_started, 'already_running', true);
  end if;
  if not meeting_play_allowed(v_sstart) then
    raise exception 'O timer só pode começar a partir de 30 min antes do início da reunião (%).',
      to_char((v_sstart - interval '30 minutes') at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  end if;
  update meeting_timers set manual_seconds = null where id = p_timer;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now())
  returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end;
$$;

revoke execute on function meeting_timer_start(uuid, text, uuid, uuid[]) from public, anon;
revoke execute on function meeting_timer_resume(uuid)                    from public, anon;
grant  execute on function meeting_timer_start(uuid, text, uuid, uuid[]) to authenticated;
grant  execute on function meeting_timer_resume(uuid)                    to authenticated;

-- 3) readable_meeting_timers (0149 — sem `edited`).
drop function if exists readable_meeting_timers();
create function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz,
  finalized boolean, base_seconds bigint, server_now timestamptz
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         (t.finalized_at is not null),
         coalesce(t.manual_seconds::bigint,
           coalesce((select sum(extract(epoch from (s.ended_at - s.started_at)))::bigint
                       from meeting_timer_segments s
                      where s.timer_id = t.id and s.ended_at is not null), 0)),
         now()
    from meeting_timers t;
$$;
revoke execute on function readable_meeting_timers() from public, anon;
grant  execute on function readable_meeting_timers() to authenticated;

-- 4) Histórico: remove o RPC e devolve a policy ao gate 0148 (admin/dono/editor).
drop function if exists meeting_timer_audit_list(uuid);

drop policy if exists mta_select on meeting_timer_audit;
create policy mta_select on meeting_timer_audit for select
  using (
    (select is_admin())
    or started_by = (select auth.uid())
    or edited_by  = (select auth.uid())
  );

-- 5) Auditoria volta ao formato 0148: sem event_type, edited_by NOT NULL.
--    Eventos de sistema (auto_close, edited_by NULL) não existem no formato antigo.
delete from meeting_timer_audit where edited_by is null;
alter table meeting_timer_audit drop column if exists event_type;
alter table meeting_timer_audit alter column edited_by set not null;

-- 6) Cron (0148 — +3h / início+4h, sem +5h e sem limite de 12h; sem auditoria).
create or replace function meeting_timer_cron()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_count int := 0;
begin
  for r in
    select t.id as timer_id, s.id as seg_id, t.started_by, t.company_id, t.title
      from meeting_timer_segments s
      join meeting_timers t on t.id = s.timer_id
     where s.ended_at is null and s.notified_overrun = false
       and t.finalized_at is null
       and t.scheduled_end is not null
       and now() >= t.scheduled_end + interval '15 minutes'
  loop
    perform push_notification(r.started_by, 'reuniao_em_andamento',
      'Reunião ainda em andamento?', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
    update meeting_timer_segments set notified_overrun = true where id = r.seg_id;
  end loop;

  for r in
    select t.id as timer_id, t.started_by, t.company_id, t.title,
           case when t.scheduled_end is not null
                then t.scheduled_end + interval '3 hours'
                else (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id)
                     + interval '4 hours' end as close_target
      from meeting_timers t
     where t.finalized_at is null
  loop
    if r.close_target is not null and now() >= r.close_target then
      update meeting_timer_segments
         set ended_at = greatest(r.close_target, started_at), end_reason = 'auto'
       where timer_id = r.timer_id and ended_at is null;
      update meeting_timers set finalized_at = now(), finalized_reason = 'auto'
       where id = r.timer_id;
      perform push_notification(r.started_by, 'reuniao_encerrada_auto',
        'Reunião encerrada automaticamente', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke execute on function meeting_timer_cron() from public, anon, authenticated;
