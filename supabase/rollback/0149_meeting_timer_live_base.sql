-- =====================================================================
-- ROLLBACK da 0149 — restaura as leituras da 0148 (total_seconds / seconds).
-- =====================================================================

-- 1) readable_meeting_timers (0148 — total_seconds efetivo, sem server_now).
drop function if exists readable_meeting_timers();
create function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz,
  finalized boolean, total_seconds bigint
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         (t.finalized_at is not null),
         coalesce(t.manual_seconds::bigint,
           coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                       from meeting_timer_segments s where s.timer_id = t.id), 0))
    from meeting_timers t;
$$;
revoke execute on function readable_meeting_timers() from public, anon;
grant  execute on function readable_meeting_timers() to authenticated;

-- 2) my_open_meeting_timer (0147/0148 — total_seconds efetivo).
drop function if exists my_open_meeting_timer();
create function my_open_meeting_timer()
returns table(timer_id uuid, title text, company_id uuid, started_at timestamptz, total_seconds bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.company_id, s.started_at,
         coalesce((select sum(extract(epoch from (coalesce(x.ended_at, now()) - x.started_at)))::bigint
                     from meeting_timer_segments x where x.timer_id = t.id), 0)
    from meeting_timers t
    join meeting_timer_segments s on s.timer_id = t.id and s.ended_at is null
   where t.started_by = auth.uid()
   order by s.started_at desc limit 1;
$$;
revoke execute on function my_open_meeting_timer() from public, anon;
grant  execute on function my_open_meeting_timer() to authenticated;

-- 3) company_meeting_hours (0148 — seconds efetivo por consultor).
drop function if exists company_meeting_hours(uuid, date, date);
create function company_meeting_hours(
  p_company uuid, p_start date default null, p_end date default null
) returns table(user_id uuid, user_name text, avatar_path text, seconds bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_hours: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with eff as (
    select t.id as timer_id, t.company_id,
           coalesce(t.manual_seconds::bigint,
             coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                         from meeting_timer_segments s where s.timer_id = t.id), 0)) as secs,
           (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start
      from meeting_timers t
  ),
  scoped as (
    select timer_id, secs from eff
     where company_id = p_company
       and (p_start is null or first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
       and (p_end   is null or first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
  )
  select mtp.user_id, pr.full_name, pr.avatar_path, sum(sc.secs)::bigint
    from scoped sc
    join meeting_timer_people mtp on mtp.timer_id = sc.timer_id
    join profiles pr on pr.id = mtp.user_id
   group by mtp.user_id, pr.full_name, pr.avatar_path
   order by pr.full_name;
end;
$$;
revoke execute on function company_meeting_hours(uuid, date, date) from public, anon;
grant  execute on function company_meeting_hours(uuid, date, date) to authenticated;
