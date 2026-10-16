-- =====================================================================
-- CRM/Timer - Monvatti :: Calibração — apoio à reorganização da tela
-- =====================================================================
-- Só apresentação da página /admin/atendimento-calibracao. Dois agregados novos
-- (somados no banco, admin-only): nº de sessões por (pessoa, empresa) na comparação
-- (coluna "Contatos" do bloco "Conversa sem cronômetro") e a linha do tempo de UMA
-- empresa (sessões estimadas + atendimentos cronometrados) para o painel de detalhe.
-- Nenhuma regra de cálculo muda.
-- =====================================================================

-- attendance_comparison ganha `sessions` (nº de atendimentos estimados por empresa).
drop function if exists attendance_comparison(date, date, text, boolean);
create or replace function attendance_comparison(
  p_start date, p_end date, p_bucket text, p_exclude_auto boolean
)
returns table(
  profile_id uuid, user_name text,
  company_id uuid, company_number text, company_name text,
  bucket date,
  timed_minutes numeric, est_minutes numeric, est_out_task_minutes numeric,
  cc_chat_minutes numeric, cc_timed_minutes numeric, sessions integer
)
language sql stable security definer set search_path = public
as $$
with
enabled as (select id as profile_id, full_name from profiles where attendance_timer_enabled),
comp_for_contact as (
  select distinct on (c.whatsapp_contact_id) c.whatsapp_contact_id as contact_id, c.id as company_id
    from companies c left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id
),
bkt as (select lower(coalesce(p_bucket,'day')) as b),
timed as (
  select e.profile_id, e.full_name as user_name, ae.company_id,
         case (select b from bkt) when 'week' then date_trunc('week', x.d)::date when 'month' then date_trunc('month', x.d)::date else x.d end as bucket,
         sum(extract(epoch from (coalesce(ae.ended_at, now()) - ae.started_at)) / 60.0) as timed_minutes
    from attendance_entries ae
    join enabled e on e.profile_id = ae.user_id
    cross join lateral (select (ae.started_at at time zone 'America/Sao_Paulo')::date as d) x
   where (not p_exclude_auto or not ae.auto_closed)
     and (p_start is null or x.d >= p_start) and (p_end is null or x.d <= p_end)
   group by e.profile_id, e.full_name, ae.company_id, bucket
),
est as (
  select e.profile_id, e.full_name as user_name, cf.company_id,
         case (select b from bkt) when 'week' then date_trunc('week', es.day)::date when 'month' then date_trunc('month', es.day)::date else es.day end as bucket,
         sum(es.minutes) as est_minutes,
         sum(es.minutes - es.overlap_task_minutes) as est_out_task_minutes,
         sum(es.overlap_controle_conta_minutes) as cc_chat_minutes,
         sum(es.sessions) as est_sessions
    from attendance_estimates es
    join digisac_users du on du.id = es.digisac_user_id
    join enabled e on e.profile_id = du.profile_id
    join comp_for_contact cf on cf.contact_id = es.contact_id
   where (p_start is null or es.day >= p_start) and (p_end is null or es.day <= p_end)
   group by e.profile_id, e.full_name, cf.company_id, bucket
),
cc_timed as (
  select e.profile_id, ti.company_id,
         case (select b from bkt) when 'week' then date_trunc('week', x.d)::date when 'month' then date_trunc('month', x.d)::date else x.d end as bucket,
         sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 60.0) as cc_timed_minutes
    from time_entries te
    join task_instances ti on ti.id = te.task_id and ti.title = 'Controle de Conta'
    join enabled e on e.profile_id = te.collaborator_id
    cross join lateral (select (te.started_at at time zone 'America/Sao_Paulo')::date as d) x
   where (p_start is null or x.d >= p_start) and (p_end is null or x.d <= p_end)
   group by e.profile_id, ti.company_id, bucket
),
keys as (
  select profile_id, company_id, bucket from timed
  union select profile_id, company_id, bucket from est
  union select profile_id, company_id, bucket from cc_timed
)
select k.profile_id,
       (select full_name from enabled e where e.profile_id = k.profile_id) as user_name,
       k.company_id,
       substring(c.name from '^\s*(\d+)') as company_number, c.name as company_name,
       k.bucket,
       round(coalesce(t.timed_minutes,0), 2) as timed_minutes,
       round(coalesce(x.est_minutes,0), 2) as est_minutes,
       round(coalesce(x.est_out_task_minutes,0), 2) as est_out_task_minutes,
       round(coalesce(x.cc_chat_minutes,0), 2) as cc_chat_minutes,
       round(coalesce(cc.cc_timed_minutes,0), 2) as cc_timed_minutes,
       coalesce(x.est_sessions,0)::int as sessions
  from (select distinct profile_id, company_id, bucket from keys) k
  left join timed t using (profile_id, company_id, bucket)
  left join est x using (profile_id, company_id, bucket)
  left join cc_timed cc using (profile_id, company_id, bucket)
  left join companies c on c.id = k.company_id
 where (select is_admin())
 order by user_name, c.name, k.bucket;
$$;

-- Linha do tempo de UMA empresa para uma pessoa no período (painel de detalhe):
-- sessões estimadas + atendimentos cronometrados, em ordem de horário.
create or replace function attendance_company_timeline(
  p_start date, p_end date, p_profile_id uuid, p_company_id uuid
)
returns table(
  kind text, started_at timestamptz, ended_at timestamptz,
  minutes numeric, team_msgs integer, client_msgs integer, in_task boolean, auto_closed boolean
)
language sql stable security definer set search_path = public
as $$
with
ct as (select whatsapp_contact_id as contact_id from companies where id = p_company_id and whatsapp_contact_id is not null),
sess as (
  select 'estimada'::text as kind, s.started_at, s.ended_at, s.minutes, s.team_msgs, s.client_msgs,
         (s.overlap_task_minutes > 0) as in_task, false as auto_closed
    from attendance_sessions s
    join digisac_users du on du.id = s.digisac_user_id
    join ct on ct.contact_id = s.contact_id
   where du.profile_id = p_profile_id and s.day between p_start and p_end
),
cron as (
  select 'cronometro'::text as kind, ae.started_at, ae.ended_at,
         round(extract(epoch from (coalesce(ae.ended_at, now()) - ae.started_at))/60.0, 2) as minutes,
         null::int as team_msgs, null::int as client_msgs, null::boolean as in_task, ae.auto_closed
    from attendance_entries ae
   where ae.user_id = p_profile_id and ae.company_id = p_company_id
     and (ae.started_at at time zone 'America/Sao_Paulo')::date between p_start and p_end
)
select kind, started_at, ended_at, minutes, team_msgs, client_msgs, in_task, auto_closed
  from (select * from sess union all select * from cron) u
 where (select is_admin())
 order by started_at;
$$;

grant execute on function attendance_comparison(date, date, text, boolean) to authenticated;
grant execute on function attendance_company_timeline(date, date, uuid, uuid) to authenticated;
