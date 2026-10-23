-- =====================================================================
-- ROLLBACK 0152 — volta followup_board para a assinatura (int) da 0151 e
-- remove followup_scores_export.
-- =====================================================================

drop function if exists followup_scores_export(date);

drop function if exists followup_board(date);
create function followup_board(p_period_days int default 30)
returns table(
  company_id uuid, company_name text, consultants jsonb,
  relevant_day date, color text, is_today boolean,
  first_msg_at timestamptz, last_msg_at timestamptz, next_meeting_at timestamptz,
  days_verde int, days_amarelo int, days_vermelho int,
  responsible_id uuid, responsible_name text
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
    select distinct on (fds.company_id)
           fds.company_id, fds.color, fds.first_msg_at, fds.collaborator_id
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
           jsonb_agg(jsonb_build_object('id', cc.consultant_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_consultants cc join scoped s on s.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.consultant_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  )
  select s.id, s.name, coalesce(cons.list, '[]'::jsonb),
         v_relevant,
         coalesce(rel.color, 'vermelho'),
         (v_relevant = v_today and followup_is_business_day(v_today)),
         rel.first_msg_at, lastmsg.at, nextmeet.at,
         coalesce(tally.v, 0)::int, coalesce(tally.a, 0)::int, coalesce(tally.r, 0)::int,
         rel.collaborator_id, resp.rname
    from scoped s
    left join rel      on rel.company_id = s.id
    left join tally    on tally.company_id = s.id
    left join lastmsg  on lastmsg.company_id = s.id
    left join nextmeet on nextmeet.company_id = s.id
    left join cons     on cons.company_id = s.id
    left join lateral (
      select rp.name as rname
        from display_profiles(array[rel.collaborator_id]::uuid[]) rp
    ) resp on rel.collaborator_id is not null
   order by
     case coalesce(rel.color, 'vermelho')
       when 'vermelho' then 0 when 'aguardando' then 1 when 'amarelo' then 2 else 3 end,
     lastmsg.at asc nulls first, s.name;
end;
$$;
revoke execute on function followup_board(int) from public, anon;
grant  execute on function followup_board(int) to authenticated;
