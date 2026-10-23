-- =====================================================================
-- 0153 — Balões de responsáveis + modelo no drill-down da Capacidade
-- =====================================================================
-- (A) followup_board passa a devolver também os COLABORADORES responsáveis da
--     empresa (company_collaborators), em jsonb, para o quadro mostrar os chips
--     de colaborador ao lado dos de consultor. Muda o retorno ⇒ DROP + CREATE.
-- (B) team_capacity_drilldown passa a devolver o MODELO DE PROJETO da empresa
--     (etiqueta calculada — labels.derived_kind='project_model'), em jsonb, para
--     o painel de detalhe mostrar o balão do modelo ao lado do grupo. Muda o
--     retorno ⇒ DROP + CREATE.
-- Convenção [[funcao-nova-revoke-anon]]: REVOKE public, anon em tudo que toco.
-- Nada de política de RLS alterada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) followup_board — + collaborators jsonb.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- (B) team_capacity_drilldown — + project_model jsonb (etiqueta calculada).
-- ---------------------------------------------------------------------
drop function if exists team_capacity_drilldown(uuid, text, date, date);
create function team_capacity_drilldown(
  p_person uuid, p_scope text, p_start date default null, p_end date default null
)
returns table (
  company_id uuid, company_name text, group_name text, project_model jsonb,
  labels jsonb, shared_with jsonb, days_since integer
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
  v_red_day  date := followup_last_closed_business_day();
  v_today    date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not is_admin() then
    raise exception 'team_capacity_drilldown: acesso restrito a administradores' using errcode = '42501';
  end if;

  return query
  with
  active_carteira as (
    select cc.company_id
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
     where cc.consultant_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  ),
  cnt as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  red_last as (
    select company_id from followup_daily_scores where d = v_red_day and color = 'vermelho'
  ),
  carteira_scoped as (
    select ac.company_id,
           coalesce(cnt.n, 1) as ncons,
           (rl.company_id is not null) as is_red,
           (select v_today - (max(dm.sent_at) at time zone 'America/Sao_Paulo')::date
              from digisac_messages dm
              join companies cx on cx.id = ac.company_id
             where dm.contact_id = cx.whatsapp_contact_id
               and dm.is_from_me and not dm.is_from_bot and not dm.is_comment) as dsince
      from active_carteira ac
      left join cnt on cnt.company_id = ac.company_id
      left join red_last rl on rl.company_id = ac.company_id
  ),
  scoped as (
    select cs.company_id, cs.dsince
      from carteira_scoped cs
     where p_scope in ('ativos','exclusivos','compartilhados','alerta','parados','sem_registro')
       and case p_scope
             when 'exclusivos'     then cs.ncons = 1
             when 'compartilhados' then cs.ncons > 1
             when 'alerta'         then exists (
               select 1 from company_labels cl
                 join labels l on l.id = cl.label_id
                where cl.company_id = cs.company_id and lower(l.name) = 'alerta')
             when 'parados'        then cs.is_red
             when 'sem_registro'   then cs.dsince is null
             else true
           end
    union all
    select e.company_id, null::integer
      from (
        select distinct t.company_id
          from time_entries te join task_instances t on t.id = te.task_id
         where p_scope = 'empresas' and te.collaborator_id = p_person
           and (v_start_ts is null or te.started_at >= v_start_ts)
           and (v_end_ts   is null or te.started_at <  v_end_ts)
        union
        select distinct ti.company_id
          from task_instances ti join task_templates tt on tt.id = ti.template_id
         where p_scope = 'empresas' and ti.collaborator_id = p_person
           and ti.status = 'finalizada' and tt.kind = 'unica' and ti.finished_at is not null
           and (v_start_ts is null or ti.finished_at >= v_start_ts)
           and (v_end_ts   is null or ti.finished_at <  v_end_ts)
      ) e
     where e.company_id is not null
    union all
    select distinct ti.company_id, null::integer
      from task_instances ti
     where p_scope = 'fora_da_carteira' and ti.collaborator_id = p_person
       and ti.company_id is not null and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id and cc.collaborator_id = p_person )
    union all
    select ccx.company_id, null::integer
      from company_collaborators ccx
      join companies c on c.id = ccx.company_id
      left join company_groups g on g.id = c.group_id
     where p_scope = 'colab_ativos' and ccx.collaborator_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  )
  select
    s.company_id, c.name, coalesce(g.name, 'Sem grupo'),
    pm.model,
    coalesce(lab.list, '[]'::jsonb), coalesce(sh.list, '[]'::jsonb), s.dsince
  from scoped s
  join companies c on c.id = s.company_id
  left join company_groups g on g.id = c.group_id
  left join lateral (
    select jsonb_build_object('name', l.name, 'bg_color', l.bg_color, 'text_color', l.text_color) as model
      from company_details cd
      join labels l on l.derived_kind = 'project_model' and l.derived_value = cd.project_model::text
     where cd.company_id = s.company_id and cd.project_model is not null
  ) pm on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('name', l.name, 'bg_color', l.bg_color,
                     'text_color', l.text_color, 'highlight', l.highlight)
                     order by l.highlight desc, l.name) as list
      from company_labels cl join labels l on l.id = cl.label_id
     where cl.company_id = s.company_id
  ) lab on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_consultants cc2
      cross join lateral display_profiles(array[cc2.consultant_id]::uuid[]) d
     where p_scope = 'compartilhados' and cc2.company_id = s.company_id
       and cc2.consultant_id <> p_person
  ) sh on true
  order by c.name;
end;
$$;
revoke execute on function team_capacity_drilldown(uuid, text, date, date) from public, anon;
grant  execute on function team_capacity_drilldown(uuid, text, date, date) to authenticated;
