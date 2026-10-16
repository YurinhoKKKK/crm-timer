-- =====================================================================
-- CRM/Timer - Monvatti :: Capacidade de ATENDIMENTO (WhatsApp) — ETAPA 3
-- =====================================================================
-- Seção "Atendimento por WhatsApp" na Capacidade (admin-only): tempo médio por
-- cliente e carga por pessoa, para ESTUDAR capacidade (não é meta).
--
-- REGRA CENTRAL (não contar em dobro): a CARGA de atendimento de uma pessoa é o chat
-- FORA de cronômetro de tarefa = (minutes - overlap_task_minutes) das sessões + pisos
-- de comunicado colado (sempre fora de tarefa). O chat DENTRO de tarefa é só
-- informação ("já contado no tempo de tarefas") e NUNCA é somado ao tempo de tarefas.
-- Por CLIENTE o tempo é o chat TOTAL (dentro+fora), porque ali a pergunta é quanto o
-- cliente consome; mostramos também quanto foi fora de tarefa.
--
-- Tudo agregado no banco (médias e MEDIANA via percentile_cont); nada somado no JS.
-- Empresa resolvida por companies.whatsapp_contact_id na leitura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Chave de calibração (controla a faixa de aviso na tela).
-- ---------------------------------------------------------------------
alter table attendance_params
  add column if not exists calibrated boolean not null default false,
  add column if not exists calibrated_at timestamptz;

create or replace function attendance_set_calibrated(p_value boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'apenas administradores';
  end if;
  update attendance_params
     set calibrated = p_value,
         calibrated_at = case when p_value then now() else calibrated_at end
   where id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Correção da pendência 2.1: estimates passa a ser derivada dos VALORES JÁ
--    GRAVADOS das sessões (2 casas) + pisos de comunicado (2 casas). Antes era
--    round(soma em precisão cheia), o que divergia das sessões por arredondamento
--    (±0,01–0,02 em ~455 linhas, 4,58 min no total — não era erro de cálculo, só
--    convenção). Agora estimates reconcilia com attendance_sessions ao centavo.
--    Passos (a)-(g) idênticos à 0130; muda só o passo (h).
-- ---------------------------------------------------------------------
create or replace function recompute_attendance(p_from date, p_to date)
returns void
language plpgsql security definer
  set search_path = public
  set statement_timeout = '240s'
as $$
declare r attendance_params%rowtype;
begin
  select * into r from attendance_params limit 1;

  drop table if exists _rows;
  create temp table _rows as
    select row_number() over () as sid, *
      from attendance_sessions_compute(p_from, p_to, r.gap_minutes, r.floor_minutes,
                                       r.prep_minutes, r.long_session_minutes,
                                       r.broadcast_min_groups, r.broadcast_window_seconds);
  create index on _rows (sid);
  analyze _rows;

  drop table if exists _cfc;
  create temp table _cfc as
    select distinct on (c.whatsapp_contact_id)
           c.whatsapp_contact_id as contact_id, c.id as company_id
      from companies c left join company_groups g on g.id = c.group_id
     where c.whatsapp_contact_id is not null
     order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id;
  create index on _cfc (contact_id);
  analyze _cfc;

  drop table if exists _ss;
  create temp table _ss as
    select rw.sid, rw.started_at, rw.ended_at, du.profile_id as collab, cfc.company_id as sess_company
      from _rows rw
      join digisac_users du on du.id = rw.digisac_user_id
      left join _cfc cfc on cfc.contact_id = rw.contact_id
     where not rw.is_broadcast and du.profile_id is not null and rw.ended_at > rw.started_at;
  create index on _ss (collab);
  analyze _ss;

  drop table if exists _te;
  create temp table _te as
    select te.collaborator_id as collab, ti.company_id, (ti.title = 'Controle de Conta') as is_cc,
           te.started_at as lo, coalesce(te.ended_at, now()) as hi
      from time_entries te
      join task_instances ti on ti.id = te.task_id
     where coalesce(te.ended_at, now()) > te.started_at
       and te.collaborator_id in (select distinct collab from _ss);
  analyze _te;

  drop table if exists _te_all;
  create temp table _te_all as
    with m as (select collab, lo, hi, max(hi) over (partition by collab order by lo, hi rows between unbounded preceding and 1 preceding) as pmax from _te),
         g as (select *, sum(case when pmax is null or lo > pmax then 1 else 0 end) over (partition by collab order by lo, hi) as gid from m)
    select collab, min(lo) as lo, max(hi) as hi from g group by collab, gid;
  create index on _te_all (collab);

  drop table if exists _te_co;
  create temp table _te_co as
    with m as (select collab, company_id, lo, hi, max(hi) over (partition by collab, company_id order by lo, hi rows between unbounded preceding and 1 preceding) as pmax from _te),
         g as (select *, sum(case when pmax is null or lo > pmax then 1 else 0 end) over (partition by collab, company_id order by lo, hi) as gid from m)
    select collab, company_id, min(lo) as lo, max(hi) as hi from g group by collab, company_id, gid;
  create index on _te_co (collab, company_id);

  drop table if exists _te_cc;
  create temp table _te_cc as
    with e as (select collab, lo, hi from _te where is_cc),
         m as (select collab, lo, hi, max(hi) over (partition by collab order by lo, hi rows between unbounded preceding and 1 preceding) as pmax from e),
         g as (select *, sum(case when pmax is null or lo > pmax then 1 else 0 end) over (partition by collab order by lo, hi) as gid from m)
    select collab, min(lo) as lo, max(hi) as hi from g group by collab, gid;
  create index on _te_cc (collab);
  analyze _te_all; analyze _te_co; analyze _te_cc;

  drop table if exists _ov;
  create temp table _ov as
    select sid, sum(ov_all) as raw_all, sum(ov_co) as raw_co, sum(ov_cc) as raw_cc from (
      select ss.sid,
             greatest(0, extract(epoch from (least(ss.ended_at, m.hi) - greatest(ss.started_at, m.lo)))) as ov_all,
             0::numeric as ov_co, 0::numeric as ov_cc
        from _ss ss join _te_all m on m.collab = ss.collab and ss.started_at < m.hi and m.lo < ss.ended_at
      union all
      select ss.sid, 0,
             greatest(0, extract(epoch from (least(ss.ended_at, m.hi) - greatest(ss.started_at, m.lo)))), 0
        from _ss ss join _te_co m on m.collab = ss.collab and m.company_id = ss.sess_company and ss.started_at < m.hi and m.lo < ss.ended_at
      union all
      select ss.sid, 0, 0,
             greatest(0, extract(epoch from (least(ss.ended_at, m.hi) - greatest(ss.started_at, m.lo))))
        from _ss ss join _te_cc m on m.collab = ss.collab and ss.started_at < m.hi and m.lo < ss.ended_at
    ) u group by sid;
  create index on _ov (sid);
  analyze _ov;

  delete from attendance_sessions where day between p_from and p_to;
  insert into attendance_sessions
    (digisac_user_id, contact_id, started_at, ended_at, minutes, day, team_msgs, client_msgs,
     is_long, overlap_task_minutes, overlap_same_company_minutes, overlap_controle_conta_minutes, computed_at)
  select rw.digisac_user_id, rw.contact_id, rw.started_at, rw.ended_at, round(rw.minutes,2), rw.day,
         rw.team_msgs, rw.client_msgs, rw.is_long,
         round(coalesce(o.raw_all,0) / nullif(extract(epoch from (rw.ended_at - rw.started_at)),0) * rw.minutes, 2),
         round(coalesce(o.raw_co ,0) / nullif(extract(epoch from (rw.ended_at - rw.started_at)),0) * rw.minutes, 2),
         round(coalesce(o.raw_cc ,0) / nullif(extract(epoch from (rw.ended_at - rw.started_at)),0) * rw.minutes, 2),
         now()
    from _rows rw left join _ov o on o.sid = rw.sid
   where not rw.is_broadcast;

  -- (h) estimates = soma dos VALORES GRAVADOS das sessões (2 casas) + pisos de
  --     comunicado (2 casas) → reconcilia ao centavo com attendance_sessions.
  delete from attendance_estimates where day between p_from and p_to;
  with sa as (
    select day, contact_id, digisac_user_id,
           sum(minutes) as m, count(*) as n, sum(team_msgs) as tm, sum(client_msgs) as cm,
           sum(case when is_long then 1 else 0 end) as ls,
           sum(overlap_task_minutes) as ot, sum(overlap_same_company_minutes) as os,
           sum(overlap_controle_conta_minutes) as oc
      from attendance_sessions where day between p_from and p_to
     group by day, contact_id, digisac_user_id
  ),
  bc as (
    select day, contact_id, digisac_user_id, sum(round(minutes,2)) as m, sum(broadcast_msgs) as bm
      from _rows where is_broadcast
     group by day, contact_id, digisac_user_id
  ),
  keys as (
    select day, contact_id, digisac_user_id from sa
    union
    select day, contact_id, digisac_user_id from bc
  )
  insert into attendance_estimates
    (day, contact_id, digisac_user_id, minutes, sessions, team_msgs, client_msgs,
     long_sessions, broadcast_msgs, overlap_task_minutes, overlap_same_company_minutes,
     overlap_controle_conta_minutes, computed_at)
  select k.day, k.contact_id, k.digisac_user_id,
         round(coalesce(sa.m,0) + coalesce(bc.m,0), 2),
         coalesce(sa.n,0)::int, coalesce(sa.tm,0)::int, coalesce(sa.cm,0)::int, coalesce(sa.ls,0)::int,
         coalesce(bc.bm,0)::int,
         coalesce(sa.ot,0), coalesce(sa.os,0), coalesce(sa.oc,0), now()
    from keys k
    left join sa on sa.day=k.day and sa.contact_id=k.contact_id and sa.digisac_user_id is not distinct from k.digisac_user_id
    left join bc on bc.day=k.day and bc.contact_id=k.contact_id and bc.digisac_user_id is not distinct from k.digisac_user_id;

  drop table if exists _rows; drop table if exists _cfc; drop table if exists _ss;
  drop table if exists _te; drop table if exists _te_all; drop table if exists _te_co;
  drop table if exists _te_cc; drop table if exists _ov;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Uma empresa por contato (helper repetido nas RPCs; CTE inline).
--    Leitura das RPCs de capacidade (admin-only). As três colunas de overlap já
--    estão em attendance_estimates; a carga é minutes - overlap_task_minutes.
-- ---------------------------------------------------------------------

-- Tabela de clientes medidos no período.
create or replace function attendance_capacity_clients(p_start date, p_end date)
returns table(
  company_id uuid, company_number text, company_name text,
  project_model text, group_name text,
  hours numeric, monthly_hours numeric, pct_out_task numeric,
  sessions integer, team_msgs integer, client_msgs integer, people integer
)
language sql stable security definer set search_path = public
as $$
with
cfc as (
  select distinct on (c.whatsapp_contact_id) c.whatsapp_contact_id as contact_id, c.id as company_id, c.name, c.group_id
    from companies c left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id
),
pdays as (select greatest(1, (p_end - p_start + 1))::numeric as d),
agg as (
  select cfc.company_id, cfc.name, cfc.group_id,
         sum(e.minutes) as total_min, sum(e.minutes - e.overlap_task_minutes) as out_min,
         sum(e.sessions)::int as sessions, sum(e.team_msgs)::int as team_msgs, sum(e.client_msgs)::int as client_msgs,
         count(distinct coalesce(e.digisac_user_id,'∅'))::int as people
    from attendance_estimates e
    join cfc on cfc.contact_id = e.contact_id
   where e.day between p_start and p_end
   group by cfc.company_id, cfc.name, cfc.group_id
)
select a.company_id, substring(a.name from '^\s*(\d+)') as company_number, a.name,
       cd.project_model::text, g.name as group_name,
       round(a.total_min/60.0, 2) as hours,
       round(a.total_min/60.0 * 30.0 / (select d from pdays), 2) as monthly_hours,
       case when a.total_min > 0 then round(100.0 * a.out_min / a.total_min, 1) else 0 end as pct_out_task,
       a.sessions, a.team_msgs, a.client_msgs, a.people
  from agg a
  left join company_details cd on cd.company_id = a.company_id
  left join company_groups g on g.id = a.group_id
 where (select is_admin())
 order by a.total_min desc;
$$;

-- Resumo: geral, por modelo e por grupo (média + MEDIANA de horas/cliente/mês) +
-- contagem de empresas ativas sem contato vinculado (não medidas).
create or replace function attendance_capacity_summary(p_start date, p_end date)
returns table(dim text, key text, n_clients integer, avg_monthly_h numeric, median_monthly_h numeric)
language sql stable security definer set search_path = public
as $$
with
cfc as (
  select distinct on (c.whatsapp_contact_id) c.whatsapp_contact_id as contact_id, c.id as company_id, c.group_id
    from companies c left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id
),
pdays as (select greatest(1, (p_end - p_start + 1))::numeric as d),
agg as (
  select cfc.company_id, cfc.group_id, sum(e.minutes) as total_min
    from attendance_estimates e join cfc on cfc.contact_id = e.contact_id
   where e.day between p_start and p_end
   group by cfc.company_id, cfc.group_id
),
cli as (
  select a.company_id, cd.project_model, g.name as group_name,
         a.total_min/60.0 * 30.0 / (select d from pdays) as monthly_h
    from agg a
    left join company_details cd on cd.company_id = a.company_id
    left join company_groups g on g.id = a.group_id
),
rows as (
  select 'geral'::text as dim, 'Geral'::text as key, count(*)::int as n_clients,
         round(avg(monthly_h),2) as avg_monthly_h,
         round(percentile_cont(0.5) within group (order by monthly_h)::numeric,2) as median_monthly_h
    from cli
  union all
  select 'modelo', coalesce(project_model::text,'sem modelo'), count(*)::int,
         round(avg(monthly_h),2), round(percentile_cont(0.5) within group (order by monthly_h)::numeric,2)
    from cli group by project_model
  union all
  select 'grupo', coalesce(group_name,'(sem grupo)'), count(*)::int,
         round(avg(monthly_h),2), round(percentile_cont(0.5) within group (order by monthly_h)::numeric,2)
    from cli group by group_name
  union all
  select 'nao_medidas', 'Empresas ativas sem contato vinculado',
         (select count(*)::int from companies c join company_groups g on g.id=c.group_id where g.kind='active' and c.whatsapp_contact_id is null),
         null, null
)
select dim, key, n_clients, avg_monthly_h, median_monthly_h from rows where (select is_admin());
$$;

-- Carga por pessoa (perfil do CRM; sem perfil → nome do Digisac "(sem perfil)").
create or replace function attendance_capacity_people(p_start date, p_end date)
returns table(
  person_key text, person_label text, profile_id uuid, has_profile boolean,
  out_task_hours numeric, in_task_hours numeric, chat_total_hours numeric,
  clients integer, business_days integer, task_hours numeric
)
language sql stable security definer set search_path = public
as $$
with
cfc as (
  select distinct on (c.whatsapp_contact_id) c.whatsapp_contact_id as contact_id, c.id as company_id
    from companies c left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id
),
bd as (
  select count(*)::int as d
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') gs
   where dev_is_business_day(gs::date)
),
per as (
  select
    case when e.digisac_user_id is null then 'unidentified'
         when du.profile_id is not null then 'p:'||du.profile_id::text
         else 'd:'||e.digisac_user_id end as person_key,
    du.profile_id,
    case when e.digisac_user_id is null then 'Equipe (não identificado)'
         when du.profile_id is not null then pr.full_name
         else coalesce(du.name,'(sem nome)')||' (sem perfil)' end as person_label,
    (e.digisac_user_id is not null and du.profile_id is not null) as has_profile,
    e.minutes, e.overlap_task_minutes, cfc.company_id
  from attendance_estimates e
  left join digisac_users du on du.id = e.digisac_user_id
  left join profiles pr on pr.id = du.profile_id
  left join cfc on cfc.contact_id = e.contact_id
  where e.day between p_start and p_end
),
agg as (
  select person_key, person_label, profile_id, has_profile,
         sum(minutes - overlap_task_minutes) as out_min, sum(overlap_task_minutes) as in_min, sum(minutes) as tot_min,
         count(distinct company_id) as clients
    from per group by person_key, person_label, profile_id, has_profile
),
task as (
  select collaborator_id, sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60.0) as task_min
    from time_entries
   where (started_at at time zone 'America/Sao_Paulo')::date between p_start and p_end
   group by collaborator_id
)
select a.person_key, a.person_label, a.profile_id, a.has_profile,
       round(a.out_min/60.0, 2), round(a.in_min/60.0, 2), round(a.tot_min/60.0, 2),
       a.clients::int, (select d from bd), round(coalesce(t.task_min,0)/60.0, 2)
  from agg a
  left join task t on t.collaborator_id = a.profile_id
 where (select is_admin())
 order by a.out_min desc;
$$;

-- Clientes de uma pessoa no período (mesmas colunas da tabela de clientes).
create or replace function attendance_capacity_person_clients(p_start date, p_end date, p_profile_id uuid)
returns table(
  company_id uuid, company_number text, company_name text,
  project_model text, group_name text,
  hours numeric, monthly_hours numeric, pct_out_task numeric,
  sessions integer, team_msgs integer, client_msgs integer, people integer
)
language sql stable security definer set search_path = public
as $$
with
cfc as (
  select distinct on (c.whatsapp_contact_id) c.whatsapp_contact_id as contact_id, c.id as company_id, c.name, c.group_id
    from companies c left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id
),
pdays as (select greatest(1, (p_end - p_start + 1))::numeric as d),
agg as (
  select cfc.company_id, cfc.name, cfc.group_id,
         sum(e.minutes) as total_min, sum(e.minutes - e.overlap_task_minutes) as out_min,
         sum(e.sessions)::int as sessions, sum(e.team_msgs)::int as team_msgs, sum(e.client_msgs)::int as client_msgs,
         1 as people
    from attendance_estimates e
    join cfc on cfc.contact_id = e.contact_id
    join digisac_users du on du.id = e.digisac_user_id
   where e.day between p_start and p_end and du.profile_id = p_profile_id
   group by cfc.company_id, cfc.name, cfc.group_id
)
select a.company_id, substring(a.name from '^\s*(\d+)') as company_number, a.name,
       cd.project_model::text, g.name as group_name,
       round(a.total_min/60.0, 2) as hours,
       round(a.total_min/60.0 * 30.0 / (select d from pdays), 2) as monthly_hours,
       case when a.total_min > 0 then round(100.0 * a.out_min / a.total_min, 1) else 0 end as pct_out_task,
       a.sessions, a.team_msgs, a.client_msgs, a.people
  from agg a
  left join company_details cd on cd.company_id = a.company_id
  left join company_groups g on g.id = a.group_id
 where (select is_admin())
 order by a.total_min desc;
$$;

grant execute on function attendance_set_calibrated(boolean)                     to authenticated;
grant execute on function attendance_capacity_clients(date, date)                to authenticated;
grant execute on function attendance_capacity_summary(date, date)                to authenticated;
grant execute on function attendance_capacity_people(date, date)                 to authenticated;
grant execute on function attendance_capacity_person_clients(date, date, uuid)   to authenticated;
