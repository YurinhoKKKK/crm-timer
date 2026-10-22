-- =====================================================================
-- ROLLBACK da 0148 — restaura o estado da 0147 (editor de trechos).
-- =====================================================================
-- Reverte a simplificação: remove Finalizar/Editar/tempo manual e devolve os RPCs
-- de trecho (set/add/delete/list), a janela de operação [início-30min, fim+3h], o
-- cron que só fechava trecho aberto e a auditoria por trecho. meeting_window_ok e
-- meeting_timer_stop não foram alterados pela 0148, então ficam como estão.
-- Observação: edições de tempo gravadas pela 0148 (tabela nova) não são portadas.
-- =====================================================================

-- 1) Funções que só existem na 0148.
drop function if exists meeting_timer_finalize(uuid);
drop function if exists meeting_timer_edit(uuid, integer, text);
drop function if exists meeting_timer_total_seconds(uuid);
drop function if exists meeting_play_allowed(timestamptz);

-- 2) Auditoria por trecho (formato 0145+0147).
drop table if exists meeting_timer_audit cascade;
create table meeting_timer_audit (
  id             uuid primary key default gen_random_uuid(),
  segment_id     uuid references meeting_timer_segments(id) on delete set null,
  edited_by      uuid not null references profiles(id),
  edited_at      timestamptz not null default now(),
  old_started_at timestamptz,
  new_started_at timestamptz,
  old_ended_at   timestamptz,
  new_ended_at   timestamptz,
  action         text not null default 'edit' check (action in ('edit', 'add', 'delete')),
  timer_id       uuid
);
alter table meeting_timer_audit enable row level security;
create policy mta_select on meeting_timer_audit for select
  using (
    (select is_admin())
    or exists (
      select 1 from meeting_timer_segments s
       where s.id = segment_id and meeting_timer_owned(s.timer_id)
    )
  );
grant select on meeting_timer_audit to authenticated;

-- 3) start/resume (0147): janela meeting_window_ok [início-30min, fim+3h].
create or replace function meeting_timer_start(
  p_meeting_id      uuid default null,
  p_google_event_id text default null,
  p_company_id      uuid default null,
  p_people          uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_company   uuid;
  v_title     text;
  v_sstart    timestamptz;
  v_send      timestamptz;
  v_creator   uuid;
  v_existing  meeting_timers%rowtype;
  v_timer     uuid;
  v_open_at   timestamptz;
  v_started   timestamptz;
  v_resumed   boolean := false;
  v_pre       jsonb;
  v_person    uuid;
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
    v_timer := v_existing.id;
    v_sstart := v_existing.scheduled_start;
    v_send   := v_existing.scheduled_end;
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

  if not meeting_window_ok(v_sstart, v_send) then
    raise exception 'Fora do horário da reunião. Use ''Adicionar trecho'' para registrar o tempo.';
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
  v_sstart timestamptz; v_send timestamptz; v_exists boolean;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select true, started_by, scheduled_start, scheduled_end
    into v_exists, v_owner, v_sstart, v_send
    from meeting_timers where id = p_timer;
  if v_exists is null then
    raise exception 'Timer não encontrado.';
  end if;
  if v_owner is distinct from v_user then
    raise exception 'Só quem iniciou pode retomar o timer da reunião.' using errcode = '42501';
  end if;
  select started_at into v_started from meeting_timer_segments
   where timer_id = p_timer and ended_at is null order by started_at desc limit 1;
  if v_started is not null then
    return jsonb_build_object('timer_id', p_timer, 'started_at', v_started, 'already_running', true);
  end if;
  if not meeting_window_ok(v_sstart, v_send) then
    raise exception 'Fora do horário da reunião. Use ''Adicionar trecho'' para registrar o tempo.';
  end if;
  v_pre := meeting_timer_preempt();
  insert into meeting_timer_segments (timer_id, started_at) values (p_timer, now())
  returning started_at into v_started;
  return jsonb_build_object('timer_id', p_timer, 'started_at', v_started,
    'paused_task_id', v_pre->'paused_task_id', 'paused_task_title', v_pre->'paused_task_title');
end;
$$;

-- 4) readable_meeting_timers (0145 — sem finalized).
drop function if exists readable_meeting_timers();
create function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz, total_seconds bigint
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                     from meeting_timer_segments s where s.timer_id = t.id), 0)
    from meeting_timers t;
$$;
revoke execute on function readable_meeting_timers() from public, anon;
grant  execute on function readable_meeting_timers() to authenticated;

-- 5) horas/sessões/capacidade (0145/0147 — soma dos trechos).
create or replace function company_meeting_hours(
  p_company uuid, p_start date default null, p_end date default null
) returns table(user_id uuid, user_name text, avatar_path text, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_hours: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with seg as (
    select s.timer_id,
           sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
           min(s.started_at) as first_start
      from meeting_timer_segments s group by s.timer_id
  ),
  scoped as (
    select t.id as timer_id, seg.secs
      from meeting_timers t join seg on seg.timer_id = t.id
     where t.company_id = p_company
       and (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
       and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
  )
  select mtp.user_id, pr.full_name, pr.avatar_path, sum(sc.secs)::bigint
    from scoped sc
    join meeting_timer_people mtp on mtp.timer_id = sc.timer_id
    join profiles pr on pr.id = mtp.user_id
   group by mtp.user_id, pr.full_name, pr.avatar_path
   order by pr.full_name;
end;
$$;

create or replace function company_meeting_sessions(
  p_company uuid, p_start date default null, p_end date default null
) returns table(
  timer_id uuid, title text, started_at timestamptz, seconds bigint, auto_closed boolean,
  started_by uuid, origin_deleted boolean, people jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_sessions: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with seg as (
    select s.timer_id,
           sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
           min(s.started_at) as first_start,
           bool_or(s.end_reason = 'auto') as auto_closed
      from meeting_timer_segments s group by s.timer_id
  )
  select t.id, t.title, seg.first_start, seg.secs, seg.auto_closed, t.started_by,
         (t.origin_deleted_at is not null),
         coalesce((
           select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'avatar_path', pr.avatar_path)
                            order by pr.full_name)
             from meeting_timer_people mp join profiles pr on pr.id = mp.user_id
            where mp.timer_id = t.id
         ), '[]'::jsonb)
    from meeting_timers t join seg on seg.timer_id = t.id
   where t.company_id = p_company
     and (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by seg.first_start desc;
end;
$$;

create or replace function capacity_person_meetings(
  p_person uuid, p_start date default null, p_end date default null
) returns table(
  company_id uuid, company_name text, title text, started_at timestamptz, seconds bigint, auto_closed boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select is_admin()) then
    raise exception 'capacity_person_meetings: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with seg as (
    select s.timer_id,
           sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
           min(s.started_at) as first_start,
           bool_or(s.end_reason = 'auto') as auto_closed
      from meeting_timer_segments s group by s.timer_id
  )
  select t.company_id, c.name, t.title, seg.first_start, seg.secs, seg.auto_closed
    from meeting_timers t
    join meeting_timer_people mtp on mtp.timer_id = t.id and mtp.user_id = p_person
    join seg on seg.timer_id = t.id
    join companies c on c.id = t.company_id
   where (p_start is null or seg.first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_end   is null or seg.first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
   order by seg.first_start desc;
end;
$$;

-- team_capacity volta à meet CTE por soma de trechos (0145).
create or replace function team_capacity(p_start date default null, p_end date default null)
returns table(
  person_id uuid, person_name text, avatar_path text,
  carteira_active integer, carteira_by_group jsonb, carteira_exclusive integer,
  carteira_shared integer, carteira_alerta integer, carteira_stalled integer,
  meeting_seconds bigint, is_executor boolean, act_seconds bigint,
  act_seconds_pontual bigint, act_seconds_diaria bigint, act_pontual_done integer,
  act_overdue integer, act_companies integer, act_has_activity boolean,
  colab_active integer, colab_by_group jsonb, has_colab_carteira boolean,
  colab_out_of_portfolio integer
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity: acesso restrito a administradores' using errcode = '42501';
  end if;

  return query
  with
  people as (
    select consultant_id as id from company_consultants
    union
    select collaborator_id from task_instances where collaborator_id is not null
    union
    select collaborator_id from company_collaborators
  ),
  executors as (
    select distinct collaborator_id as id from task_instances where collaborator_id is not null
  ),
  carteira as (
    select cc.consultant_id as person,
           cc.company_id,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  active_carteira as (
    select person, company_id from carteira where is_active
  ),
  company_consultant_count as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  followup as (
    select company_id, days_since from client_followup(30, true)
  ),
  by_group as (
    select person,
           jsonb_agg(jsonb_build_object('name', gname, 'count', n) order by gpos, gname) as list
      from (
        select person, gname, gpos, count(*) as n from carteira group by person, gname, gpos
      ) q
     group by person
  ),
  cart as (
    select ac.person,
           count(*) as active,
           count(*) filter (where ccc.n = 1) as exclusive,
           count(*) filter (where ccc.n > 1) as shared,
           count(*) filter (where al.company_id is not null) as alerta,
           count(*) filter (where fu.days_since > 15)      as stalled
      from active_carteira ac
      join company_consultant_count ccc on ccc.company_id = ac.company_id
      left join followup fu on fu.company_id = ac.company_id
      left join lateral (
        select 1 as company_id
          from company_effective_labels cl
          join labels l on l.id = cl.label_id
         where cl.company_id = ac.company_id and lower(l.name) = 'alerta'
         limit 1
      ) al on true
     group by ac.person
  ),
  meet as (
    select mtp.user_id as person, sum(sg.secs)::bigint as secs
      from meeting_timer_people mtp
      join (
        select s.timer_id,
               sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint as secs,
               min(s.started_at) as first_start
          from meeting_timer_segments s group by s.timer_id
      ) sg on sg.timer_id = mtp.timer_id
     where (v_start_ts is null or sg.first_start >= v_start_ts)
       and (v_end_ts   is null or sg.first_start <  v_end_ts)
     group by mtp.user_id
  ),
  colab_carteira as (
    select cc.collaborator_id as person,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_collaborators cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  colab_by_group as (
    select person,
           jsonb_agg(jsonb_build_object('name', gname, 'count', n) order by gpos, gname) as list
      from (
        select person, gname, gpos, count(*) as n from colab_carteira group by person, gname, gpos
      ) q
     group by person
  ),
  colab_active as (
    select person, count(*) filter (where is_active) as active from colab_carteira group by person
  ),
  colab_outside as (
    select ti.collaborator_id as person, count(distinct ti.company_id) as n
      from task_instances ti
     where ti.collaborator_id is not null and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id and cc.collaborator_id = ti.collaborator_id
       )
     group by ti.collaborator_id
  ),
  act_time as (
    select te.collaborator_id as person,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at))::bigint as secs,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind = 'diaria'))::bigint as secs_diaria,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind is distinct from 'diaria'))::bigint as secs_pontual
      from time_entries te
      join task_instances t on t.id = te.task_id
      left join task_templates tt on tt.id = t.template_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
     group by te.collaborator_id
  ),
  act_done as (
    select ti.collaborator_id as person, count(*) as done
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada' and tt.kind = 'unica' and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
     group by ti.collaborator_id
  ),
  act_company_pairs as (
    select te.collaborator_id as person, t.company_id
      from time_entries te
      join task_instances t on t.id = te.task_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
    union
    select ti.collaborator_id, ti.company_id
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada' and tt.kind = 'unica' and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
  ),
  act_companies as (
    select person, count(distinct company_id) as companies
      from act_company_pairs where company_id is not null group by person
  ),
  act_overdue as (
    select ti.collaborator_id as person, count(*) as n
      from task_instances ti
     where ti.status in ('a_fazer', 'iniciada') and ti.due_at < now()
       and (p_start is null or ti.task_date >= p_start)
       and (p_end   is null or ti.task_date <  p_end)
     group by ti.collaborator_id
  )
  select
    pe.id,
    dp.name,
    dp.avatar_path,
    coalesce(cart.active, 0)::integer,
    coalesce(bg.list, '[]'::jsonb),
    coalesce(cart.exclusive, 0)::integer,
    coalesce(cart.shared, 0)::integer,
    coalesce(cart.alerta, 0)::integer,
    coalesce(cart.stalled, 0)::integer,
    coalesce(ms.secs, 0)::bigint,
    (ex.id is not null) as is_executor,
    coalesce(at.secs, 0)::bigint,
    coalesce(at.secs_pontual, 0)::bigint,
    coalesce(at.secs_diaria, 0)::bigint,
    coalesce(ad.done, 0)::integer,
    coalesce(ao.n, 0)::integer,
    coalesce(acp.companies, 0)::integer,
    (at.person is not null or ad.person is not null or ao.person is not null) as act_has_activity,
    coalesce(ca.active, 0)::integer,
    coalesce(cbg.list, '[]'::jsonb),
    (cbg.person is not null) as has_colab_carteira,
    coalesce(oop.n, 0)::integer
  from people pe
  left join lateral (
    select d.name, d.avatar_path from display_profiles(array[pe.id]::uuid[]) d
  ) dp on true
  left join executors ex on ex.id = pe.id
  left join cart      on cart.person = pe.id
  left join meet      ms on ms.person = pe.id
  left join by_group  bg on bg.person = pe.id
  left join colab_active ca on ca.person = pe.id
  left join colab_by_group cbg on cbg.person = pe.id
  left join colab_outside oop on oop.person = pe.id
  left join act_time  at on at.person = pe.id
  left join act_done  ad on ad.person = pe.id
  left join act_companies acp on acp.person = pe.id
  left join act_overdue ao on ao.person = pe.id;
end;
$$;

-- 6) cron (0145 — só fecha trecho aberto; não finaliza timer).
create or replace function meeting_timer_cron()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_count int := 0;
begin
  for r in
    select t.id as timer_id, s.id as seg_id, t.started_by, t.company_id, t.title
      from meeting_timer_segments s
      join meeting_timers t on t.id = s.timer_id
     where s.ended_at is null and s.notified_overrun = false
       and t.scheduled_end is not null
       and now() >= t.scheduled_end + interval '15 minutes'
  loop
    perform push_notification(r.started_by, 'reuniao_em_andamento',
      'Reunião ainda em andamento?', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
    update meeting_timer_segments set notified_overrun = true where id = r.seg_id;
  end loop;

  for r in
    select s.id as seg_id, s.started_at, t.id as timer_id, t.started_by, t.company_id, t.title,
           case when t.scheduled_end is not null
                then t.scheduled_end + interval '3 hours'
                else fs.first_start + interval '4 hours' end as close_target
      from meeting_timer_segments s
      join meeting_timers t on t.id = s.timer_id
      join (select timer_id, min(started_at) as first_start
              from meeting_timer_segments group by timer_id) fs on fs.timer_id = t.id
     where s.ended_at is null
  loop
    if now() >= r.close_target then
      update meeting_timer_segments
         set ended_at = greatest(r.close_target, r.started_at), end_reason = 'auto'
       where id = r.seg_id;
      perform push_notification(r.started_by, 'reuniao_encerrada_auto',
        'Reunião encerrada automaticamente', r.title, r.company_id, 'meeting_timer', r.timer_id, null);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke execute on function meeting_timer_cron() from public, anon, authenticated;

-- 7) RPCs de trecho (0145 segments_list; 0147 set/add/delete).
create or replace function meeting_timer_segments_list(p_timer uuid)
returns table(segment_id uuid, started_at timestamptz, ended_at timestamptz, end_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not meeting_timer_owned(p_timer) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;
  return query
    select s.id, s.started_at, s.ended_at, s.end_reason
      from meeting_timer_segments s where s.timer_id = p_timer order by s.started_at;
end;
$$;

create or replace function meeting_timer_set_segment(
  p_segment uuid, p_started_at timestamptz, p_ended_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare v_timer uuid; v_old_start timestamptz; v_old_end timestamptz;
begin
  select timer_id, started_at, ended_at into v_timer, v_old_start, v_old_end
    from meeting_timer_segments where id = p_segment;
  if v_timer is null then raise exception 'Trecho não encontrado.'; end if;
  if not meeting_timer_owned(v_timer) then
    raise exception 'Só admin ou quem iniciou pode corrigir a duração.' using errcode = '42501';
  end if;
  if v_old_end is null then
    raise exception 'Não é possível editar um trecho em andamento. Encerre-o primeiro.';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Início e fim são obrigatórios.';
  end if;
  if p_started_at > now() or p_ended_at > now() then
    raise exception 'Início e fim devem estar no passado.';
  end if;
  if p_ended_at <= p_started_at then raise exception 'O fim deve ser depois do início.'; end if;
  if p_ended_at - p_started_at > interval '6 hours' then
    raise exception 'Um trecho não pode passar de 6 horas.';
  end if;
  if exists (
    select 1 from meeting_timer_segments s2
     where s2.timer_id = v_timer and s2.id <> p_segment
       and tstzrange(s2.started_at, coalesce(s2.ended_at, 'infinity'), '[)')
        && tstzrange(p_started_at, p_ended_at, '[)')
  ) then
    raise exception 'O trecho se sobrepõe a outro já registrado.';
  end if;

  update meeting_timer_segments
     set started_at = p_started_at, ended_at = p_ended_at, end_reason = 'manual'
   where id = p_segment;

  insert into meeting_timer_audit
    (segment_id, timer_id, action, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (p_segment, v_timer, 'edit', auth.uid(), v_old_start, p_started_at, v_old_end, p_ended_at);
end;
$$;

create or replace function meeting_timer_add_segment(
  p_timer uuid, p_started_at timestamptz, p_ended_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_seg uuid;
begin
  if not exists (select 1 from meeting_timers where id = p_timer) then
    raise exception 'Timer não encontrado.';
  end if;
  if not meeting_timer_owned(p_timer) then
    raise exception 'Só admin ou quem iniciou pode adicionar trechos.' using errcode = '42501';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Início e fim são obrigatórios.';
  end if;
  if p_started_at > now() or p_ended_at > now() then
    raise exception 'Início e fim devem estar no passado.';
  end if;
  if p_ended_at <= p_started_at then raise exception 'O fim deve ser depois do início.'; end if;
  if p_ended_at - p_started_at > interval '6 hours' then
    raise exception 'Um trecho não pode passar de 6 horas.';
  end if;
  if exists (
    select 1 from meeting_timer_segments s2
     where s2.timer_id = p_timer
       and tstzrange(s2.started_at, coalesce(s2.ended_at, 'infinity'), '[)')
        && tstzrange(p_started_at, p_ended_at, '[)')
  ) then
    raise exception 'O trecho se sobrepõe a outro já registrado.';
  end if;

  insert into meeting_timer_segments (timer_id, started_at, ended_at, end_reason)
  values (p_timer, p_started_at, p_ended_at, 'manual') returning id into v_seg;

  insert into meeting_timer_audit
    (segment_id, timer_id, action, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (v_seg, p_timer, 'add', auth.uid(), null, p_started_at, null, p_ended_at);
  return v_seg;
end;
$$;

create or replace function meeting_timer_delete_segment(p_segment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_timer uuid; v_old_start timestamptz; v_old_end timestamptz; v_remaining int;
begin
  select timer_id, started_at, ended_at into v_timer, v_old_start, v_old_end
    from meeting_timer_segments where id = p_segment;
  if v_timer is null then raise exception 'Trecho não encontrado.'; end if;
  if not meeting_timer_owned(v_timer) then
    raise exception 'Só admin ou quem iniciou pode excluir trechos.' using errcode = '42501';
  end if;

  insert into meeting_timer_audit
    (segment_id, timer_id, action, edited_by, old_started_at, new_started_at, old_ended_at, new_ended_at)
  values (p_segment, v_timer, 'delete', auth.uid(), v_old_start, null, v_old_end, null);

  delete from meeting_timer_segments where id = p_segment;

  select count(*) into v_remaining from meeting_timer_segments where timer_id = v_timer;
  if v_remaining = 0 then
    delete from meeting_timers where id = v_timer;
  end if;
end;
$$;

revoke execute on function meeting_timer_segments_list(uuid)                        from public, anon;
revoke execute on function meeting_timer_set_segment(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function meeting_timer_add_segment(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function meeting_timer_delete_segment(uuid)                        from public, anon;
grant  execute on function meeting_timer_segments_list(uuid)                        to authenticated;
grant  execute on function meeting_timer_set_segment(uuid, timestamptz, timestamptz) to authenticated;
grant  execute on function meeting_timer_add_segment(uuid, timestamptz, timestamptz) to authenticated;
grant  execute on function meeting_timer_delete_segment(uuid)                        to authenticated;

-- 8) remove as colunas da 0148.
alter table meeting_timers
  drop column if exists manual_seconds,
  drop column if exists finalized_reason,
  drop column if exists finalized_at;
