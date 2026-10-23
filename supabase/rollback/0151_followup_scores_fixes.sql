-- =====================================================================
-- ROLLBACK 0151 — restaura as definições da 0150 (bug 42702 volta a existir).
-- =====================================================================

-- (A) followup_scores_month — versão 0150 (lateral sem qualificar).
create or replace function followup_scores_month(p_month date)
returns table(
  collaborator_id uuid, collaborator_name text, avatar_path text,
  points int, days_verde int, days_amarelo int, days_vermelho int, companies int
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date;
        v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then
    raise exception 'followup_scores_month: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  select fds.collaborator_id, dp.name, dp.avatar_path,
         sum(fds.points)::int,
         count(*) filter (where fds.color = 'verde')::int,
         count(*) filter (where fds.color = 'amarelo')::int,
         count(*) filter (where fds.color = 'vermelho')::int,
         count(distinct fds.company_id)::int
    from followup_daily_scores fds
    left join lateral (select name, avatar_path from display_profiles(array[fds.collaborator_id]::uuid[])) dp
      on fds.collaborator_id is not null
   where fds.d >= v_from and fds.d < v_to
   group by fds.collaborator_id, dp.name, dp.avatar_path
   order by sum(fds.points) desc nulls last;
end;
$$;
revoke execute on function followup_scores_month(date) from public, anon;
grant  execute on function followup_scores_month(date) to authenticated;

-- (C) followup_recompute_day — versão 0150 ('aguardando' sem checar contact_id).
create or replace function followup_recompute_day(p_day date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today      date      := (now() at time zone 'America/Sao_Paulo')::date;
  v_now_time   time      := (now() at time zone 'America/Sao_Paulo')::time;
  v_finalized  boolean   := p_day < v_today;
  v_is_current boolean   := p_day = v_today;
  v_count      int       := 0;
begin
  if not followup_is_business_day(p_day) then
    delete from followup_daily_scores where d = p_day;
    return 0;
  end if;
  if p_day > v_today then return 0; end if;

  with
  day_bounds as (
    select (p_day::timestamp at time zone 'America/Sao_Paulo') as start_ts,
           ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo') as end_ts
  ),
  active_co as (
    select c.id as company_id, c.whatsapp_contact_id
      from companies c
     where exists (select 1 from company_groups g
                    where g.id = followup_group_on_day(c.id, p_day) and g.kind = 'active')
  ),
  valid as (
    select dm.contact_id, dm.digisac_user_id, dm.sent_at
      from digisac_messages dm, day_bounds b
     where dm.is_from_me and not dm.is_from_bot and not dm.is_comment
       and dm.sent_at >= b.start_ts - interval '60 seconds'
       and dm.sent_at <  b.end_ts   + interval '60 seconds'
  ),
  good as (
    select v.contact_id, v.sent_at
      from valid v
     where v.digisac_user_id is null
        or (select count(distinct v2.contact_id) from valid v2
             where v2.digisac_user_id = v.digisac_user_id
               and v2.sent_at > v.sent_at - interval '60 seconds'
               and v2.sent_at < v.sent_at + interval '60 seconds') < 5
  ),
  first_msg as (
    select ac.company_id, min(g.sent_at) as first_at
      from active_co ac
      join good g on g.contact_id = ac.whatsapp_contact_id
      join day_bounds b on true
     where g.sent_at >= b.start_ts and g.sent_at < b.end_ts
     group by ac.company_id
  ),
  scored as (
    select ac.company_id, fm.first_at,
           (fm.first_at at time zone 'America/Sao_Paulo')::time as ft
      from active_co ac
      left join first_msg fm on fm.company_id = ac.company_id
  ),
  upserted as (
    insert into followup_daily_scores
      (d, company_id, collaborator_id, first_msg_at, color, points, finalized, computed_at)
    select p_day, s.company_id,
           (select cc.collaborator_id from company_collaborators cc
             where cc.company_id = s.company_id order by cc.collaborator_id limit 1),
           s.first_at,
           case
             when s.first_at is not null and s.ft < time '12:00:00' then 'verde'
             when s.first_at is not null and s.ft < time '17:00:00' then 'amarelo'
             when s.first_at is not null then 'vermelho'
             when v_is_current and v_now_time < time '17:00:00' then 'aguardando'
             else 'vermelho'
           end,
           case
             when s.first_at is not null and s.ft < time '12:00:00' then 1
             when s.first_at is not null and s.ft < time '17:00:00' then 0
             when s.first_at is not null then -1
             when v_is_current and v_now_time < time '17:00:00' then 0
             else -1
           end,
           v_finalized,
           now()
      from scored s
    on conflict (d, company_id) do update
       set collaborator_id = excluded.collaborator_id,
           first_msg_at    = excluded.first_msg_at,
           color           = excluded.color,
           points          = excluded.points,
           finalized       = excluded.finalized,
           computed_at     = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;

  delete from followup_daily_scores fds
   where fds.d = p_day
     and not exists (
       select 1 from company_groups g
        where g.id = followup_group_on_day(fds.company_id, p_day) and g.kind = 'active'
     );

  return v_count;
end;
$$;
revoke execute on function followup_recompute_day(date) from public, anon, authenticated;

-- (B) followup_board — versão 0150 (12 colunas, sem responsável).
drop function if exists followup_board(int);
create function followup_board(p_period_days int default 30)
returns table(
  company_id uuid, company_name text, consultants jsonb,
  relevant_day date, color text, is_today boolean,
  first_msg_at timestamptz, last_msg_at timestamptz, next_meeting_at timestamptz,
  days_verde int, days_amarelo int, days_vermelho int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_relevant date := followup_relevant_day();
  v_today    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from     date := v_today - greatest(1, coalesce(p_period_days, 30));
begin
  return query
  with scoped as (
    select c.id, c.name, c.whatsapp_contact_id
      from companies c
      join company_groups g on g.id = c.group_id and g.kind = 'active'
     where (select is_admin()) or c.id in (select my_consultant_companies())
  ),
  rel as (
    select distinct on (fds.company_id) fds.company_id, fds.color, fds.first_msg_at
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d <= v_relevant
     order by fds.company_id, fds.d desc
  ),
  tally as (
    select fds.company_id,
           count(*) filter (where fds.color = 'verde')    as v,
           count(*) filter (where fds.color = 'amarelo')  as a,
           count(*) filter (where fds.color = 'vermelho') as r
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d >= v_from and fds.d <= v_today
     group by fds.company_id
  ),
  lastmsg as (
    select s.id as company_id,
           (select max(dm.sent_at) from digisac_messages dm
             where dm.contact_id = s.whatsapp_contact_id
               and dm.is_from_me and not dm.is_from_bot and not dm.is_comment) as at
      from scoped s where s.whatsapp_contact_id is not null
  ),
  nextmeet as (
    select m.company_id, min(m.starts_at) as at
      from meetings m join scoped s on s.id = m.company_id
     where m.starts_at > now() group by m.company_id
  ),
  cons as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.consultant_id, 'name', dp.name, 'avatar_path', dp.avatar_path)
                     order by dp.name) as list
      from company_consultants cc join scoped s on s.id = cc.company_id
      left join lateral (select name, avatar_path from display_profiles(array[cc.consultant_id]::uuid[])) dp on true
     group by cc.company_id
  )
  select s.id, s.name, coalesce(cons.list, '[]'::jsonb),
         v_relevant,
         coalesce(rel.color, 'vermelho'),
         (v_relevant = v_today and followup_is_business_day(v_today)),
         rel.first_msg_at, lastmsg.at, nextmeet.at,
         coalesce(tally.v, 0)::int, coalesce(tally.a, 0)::int, coalesce(tally.r, 0)::int
    from scoped s
    left join rel      on rel.company_id = s.id
    left join tally    on tally.company_id = s.id
    left join lastmsg  on lastmsg.company_id = s.id
    left join nextmeet on nextmeet.company_id = s.id
    left join cons     on cons.company_id = s.id
   order by
     case coalesce(rel.color, 'vermelho')
       when 'vermelho' then 0 when 'aguardando' then 1 when 'amarelo' then 2 else 3 end,
     lastmsg.at asc nulls first, s.name;
end;
$$;
revoke execute on function followup_board(int) from public, anon;
grant  execute on function followup_board(int) to authenticated;
