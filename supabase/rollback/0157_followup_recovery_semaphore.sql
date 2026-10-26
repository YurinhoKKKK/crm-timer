-- =====================================================================
-- ROLLBACK da 0157 — remove a recuperação (volta ao estado 0156).
-- =====================================================================
-- Restaura followup_recompute_day/board/scores_detail/scores_export à 0156,
-- recomputa 26/10→hoje pela regra antiga (color = contato) para desfazer os
-- color/points da recuperação, e remove as colunas contact_color/recovery_need
-- e o índice (company_id, d). Linhas < 26/10 não são tocadas.
-- =====================================================================

-- 1) board → 0156 (sem contact_color/recovery_need).
drop function if exists followup_board(date);
create function followup_board(p_month date)
returns table(
  company_id uuid, company_name text, consultants jsonb, collaborators jsonb,
  relevant_day date, color text, is_today boolean,
  first_msg_at timestamptz, last_msg_at timestamptz, next_meeting_at timestamptz,
  days_verde int, days_amarelo int, days_vermelho int,
  responsible_id uuid, responsible_name text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month_start  date := date_trunc('month', p_month)::date;
  v_month_end    date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_is_current   boolean := date_trunc('month', p_month) = date_trunc('month', v_today);
  v_month_end_ts timestamptz := ((date_trunc('month', p_month) + interval '1 month')::timestamp
                                 at time zone 'America/Sao_Paulo');
  v_relevant     date;
begin
  if v_is_current then
    v_relevant := followup_relevant_day();
  else
    select max(gs::date) into v_relevant
      from generate_series(v_month_start, (v_month_end - 1), interval '1 day') gs
     where followup_is_business_day(gs::date);
  end if;

  return query
  with scoped as (
    select c.id, c.name, c.whatsapp_contact_id
      from companies c
     where ((select is_admin()) or c.id in (select my_consultant_companies()))
       and exists (select 1 from company_collaborators cc where cc.company_id = c.id)
       and (case when v_is_current
              then exists (select 1 from company_groups g where g.id = c.group_id and g.kind = 'active')
              else c.id in (select distinct fds.company_id from followup_daily_scores fds
                             where fds.d >= v_month_start and fds.d < v_month_end)
            end)
  ),
  rel as (
    select distinct on (fds.company_id)
           fds.company_id, fds.color, fds.first_msg_at, fds.collaborator_id
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d >= v_month_start and fds.d <= v_relevant
     order by fds.company_id, fds.d desc
  ),
  tally as (
    select fds.company_id,
           count(*) filter (where fds.color = 'verde')    as v,
           count(*) filter (where fds.color = 'amarelo')  as a,
           count(*) filter (where fds.color = 'vermelho') as r
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d >= v_month_start and fds.d <= v_relevant
     group by fds.company_id
  ),
  lastmsg as (
    select s.id as company_id,
           (select max(dm.sent_at) from digisac_messages dm
             where dm.contact_id = s.whatsapp_contact_id
               and dm.is_from_me and not dm.is_from_bot and not dm.is_comment
               and dm.sent_at < v_month_end_ts) as at
      from scoped s where s.whatsapp_contact_id is not null
  ),
  nextmeet as (
    select m.company_id, min(m.starts_at) as at
      from meetings m join scoped s on s.id = m.company_id
     where m.starts_at > now() group by m.company_id
  ),
  cons as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.consultant_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_consultants cc join scoped s on s.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.consultant_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  ),
  colabs as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.collaborator_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_collaborators cc join scoped s on s.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.collaborator_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  )
  select s.id, s.name,
         coalesce(cons.list, '[]'::jsonb), coalesce(colabs.list, '[]'::jsonb),
         v_relevant,
         coalesce(rel.color, 'vermelho'),
         (v_is_current and v_relevant = v_today and followup_is_business_day(v_today)),
         rel.first_msg_at, lastmsg.at,
         case when v_is_current then nextmeet.at else null end,
         coalesce(tally.v, 0)::int, coalesce(tally.a, 0)::int, coalesce(tally.r, 0)::int,
         rel.collaborator_id, resp.rname
    from scoped s
    left join rel      on rel.company_id = s.id
    left join tally    on tally.company_id = s.id
    left join lastmsg  on lastmsg.company_id = s.id
    left join nextmeet on nextmeet.company_id = s.id
    left join cons     on cons.company_id = s.id
    left join colabs   on colabs.company_id = s.id
    left join lateral (
      select rp.name as rname
        from display_profiles(array[rel.collaborator_id]::uuid[]) rp
    ) resp on rel.collaborator_id is not null
   order by
     case coalesce(rel.color, 'vermelho')
       when 'vermelho' then 0 when 'amarelo' then 1 when 'verde' then 2 else 3 end,
     lastmsg.at asc nulls first, s.name;
end;
$$;
revoke execute on function followup_board(date) from public, anon;
grant  execute on function followup_board(date) to authenticated;

-- 2) scores_detail → 0156 (sem contact_color/recovery_need).
drop function if exists followup_scores_detail(uuid, date);
create function followup_scores_detail(p_collaborator uuid, p_month date)
returns table(
  company_id uuid, company_name text, d date, color text, first_msg_at timestamptz, points int
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date;
        v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then
    raise exception 'followup_scores_detail: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  select fds.company_id, c.name, fds.d, fds.color, fds.first_msg_at, fds.points
    from followup_daily_scores fds
    join companies c on c.id = fds.company_id
   where fds.d >= v_from and fds.d < v_to
     and fds.collaborator_id is not distinct from p_collaborator
     and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_detail(uuid, date) from public, anon;
grant  execute on function followup_scores_detail(uuid, date) to authenticated;

-- 3) scores_export → 0156 (sem contact_color/recovery_need).
drop function if exists followup_scores_export(date, uuid, uuid);
create function followup_scores_export(
  p_month date, p_consultant uuid default null, p_collaborator uuid default null
)
returns table(
  d date, company_id uuid, company_name text, group_name text,
  responsible_id uuid, responsible_name text,
  first_msg_at timestamptz, color text, points int, finalized boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date;
        v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then
    raise exception 'followup_scores_export: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  select fds.d, fds.company_id, c.name,
         coalesce(g.name, '(sem grupo)'),
         fds.collaborator_id, rp.name,
         fds.first_msg_at, fds.color, fds.points, fds.finalized
    from followup_daily_scores fds
    join companies c on c.id = fds.company_id
    left join company_groups g on g.id = followup_group_on_day(fds.company_id, fds.d)
    left join lateral (
      select dpx.name from display_profiles(array[fds.collaborator_id]::uuid[]) dpx
    ) rp on fds.collaborator_id is not null
   where fds.d >= v_from and fds.d < v_to
     and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
     and (p_consultant is null or exists (
            select 1 from company_consultants cx
             where cx.company_id = fds.company_id and cx.consultant_id = p_consultant))
     and (p_collaborator is null or exists (
            select 1 from company_collaborators ck
             where ck.company_id = fds.company_id and ck.collaborator_id = p_collaborator))
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_export(date, uuid, uuid) from public, anon;
grant  execute on function followup_scores_export(date, uuid, uuid) to authenticated;

-- 4) recompute → 0156 (color = contato; sem semáforo).
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
       and exists (select 1 from company_collaborators cc where cc.company_id = c.id)
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
    select ac.company_id,
           (ac.whatsapp_contact_id is not null) as has_contact,
           fm.first_at,
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
             when v_is_current and v_now_time < time '17:00:00' and s.has_contact then 'aguardando'
             else 'vermelho'
           end,
           case
             when s.first_at is not null and s.ft < time '12:00:00' then 1
             when s.first_at is not null and s.ft < time '17:00:00' then 0
             when s.first_at is not null then -1
             when v_is_current and v_now_time < time '17:00:00' and s.has_contact then 0
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

-- 5) Recomputa 26/10→hoje pela regra antiga (desfaz color/points da recuperação).
select followup_backfill(date '2026-10-26', (now() at time zone 'America/Sao_Paulo')::date);

-- 6) Remove índice e colunas novas.
drop index if exists followup_scores_company_d_idx;
alter table followup_daily_scores
  drop column if exists recovery_need,
  drop column if exists contact_color;
