-- =====================================================================
-- CRM/Timer - Monvatti :: Sessões de atendimento + sobreposição com tarefa
-- =====================================================================
-- Etapa 2.5 do contador Digisac. Guarda cada SESSÃO estimada (início/fim já com
-- preparo e piso, minutos já divididos por sobreposição entre grupos) e mede quanto
-- de cada sessão cai dentro de um cronômetro de TAREFA da mesma pessoa — porque nas
-- tarefas "Controle de Conta" os dois Marcos foram instruídos a NÃO usar o cronômetro
-- de atendimento (já cronometram a tarefa e conversam com o cliente), então parte do
-- chat estimado já está dentro de time_entries e não pode ser contada em dobro.
--
-- REGRA PARA A CAPACIDADE (etapa 3): a carga de atendimento de uma pessoa é o chat
-- FORA de cronômetro de tarefa = minutes - overlap_task_minutes. O chat DENTRO de
-- tarefa é só informação e NUNCA deve ser somado ao tempo de tarefas.
--
-- "Controle de Conta": identificado pelo TÍTULO DA INSTÂNCIA (task_instances.title
-- = 'Controle de Conta'). O template é reaproveitado/renomeado (as instâncias de um
-- mesmo template CC têm vários títulos), então o título do modelo NÃO identifica a
-- tarefa de forma confiável — o título da instância reflete o que a tarefa era.
--
-- Tudo set-based (merge de intervalos + range overlap via funções de janela e
-- comandos em conjunto). Sem laço linha a linha. attendance_estimates passa a ser
-- derivada das sessões (+ comunicado colado); os totais de MINUTOS seguem idênticos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabela de sessões (só metadados). RLS: SELECT só admin, sem escrita.
-- ---------------------------------------------------------------------
create table if not exists attendance_sessions (
  id              uuid primary key default gen_random_uuid(),
  digisac_user_id text,                 -- null = equipe não identificada
  contact_id      text not null,
  started_at      timestamptz not null, -- já com preparo
  ended_at        timestamptz not null, -- já com piso
  minutes         numeric(10,2) not null,  -- após divisão por sobreposição entre grupos
  day             date not null,           -- BRT do início
  team_msgs       integer not null default 0,
  client_msgs     integer not null default 0,
  is_long         boolean not null default false,
  overlap_task_minutes            numeric(10,2) not null default 0,
  overlap_same_company_minutes    numeric(10,2) not null default 0,
  overlap_controle_conta_minutes  numeric(10,2) not null default 0,
  computed_at     timestamptz not null default now()
);
create index if not exists attendance_sessions_day_idx on attendance_sessions (day);
create index if not exists attendance_sessions_user_day_idx on attendance_sessions (digisac_user_id, day);
create index if not exists attendance_sessions_contact_idx on attendance_sessions (contact_id);

alter table attendance_sessions enable row level security;
drop policy if exists asess_select on attendance_sessions;
create policy asess_select on attendance_sessions for select using ((select is_admin()));
grant select on attendance_sessions to authenticated;

-- ---------------------------------------------------------------------
-- 2) attendance_estimates ganha as três colunas de sobreposição (somadas).
-- ---------------------------------------------------------------------
alter table attendance_estimates
  add column if not exists overlap_task_minutes           numeric(10,2) not null default 0,
  add column if not exists overlap_same_company_minutes   numeric(10,2) not null default 0,
  add column if not exists overlap_controle_conta_minutes numeric(10,2) not null default 0;

-- ---------------------------------------------------------------------
-- 3) FONTE ÚNICA: sessões (e comunicado colado) por parâmetros arbitrários.
--    Linha de sessão: is_broadcast=false, intervalo preenchido. Linha de
--    comunicado: is_broadcast=true, sem intervalo, minutes = 1 piso / nº grupos.
--    Mesmo núcleo set-based da 0129 (janela [from-1, to+1] BRT, sweep-line p/ a
--    divisão de sobreposição entre grupos — F(fim)-F(início), sem contar em dobro).
-- ---------------------------------------------------------------------
create or replace function attendance_sessions_compute(
  p_from date, p_to date,
  p_gap integer, p_floor numeric, p_prep numeric,
  p_long integer, p_bmin integer, p_bwin integer
)
returns table(
  day date, contact_id text, digisac_user_id text,
  started_at timestamptz, ended_at timestamptz,
  minutes numeric, team_msgs integer, client_msgs integer, is_long boolean,
  is_broadcast boolean, broadcast_msgs integer
)
language sql stable set search_path = public
as $$
with
bounds as (
  select ((p_from - 1)::timestamp at time zone 'America/Sao_Paulo') as lo,
         ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo') as hi
),
base as (
  select m.id, m.contact_id, m.digisac_user_id, m.sent_at,
    case
      when coalesce(m.is_from_me,false) and coalesce(m.visible,true)
           and not coalesce(m.is_from_bot,false) and coalesce(m.origin,'') <> 'bot'
           and not coalesce(m.is_comment,false) then 'team'
      when not coalesce(m.is_from_me,false) and coalesce(m.visible,true)
           and not coalesce(m.is_comment,false) then 'client'
      else null end as kind
  from digisac_messages m cross join bounds b
  where m.sent_at >= b.lo and m.sent_at < b.hi
),
msgs as (select * from base where kind is not null),
team_all as (select id, contact_id, digisac_user_id, sent_at, coalesce(digisac_user_id,'') as person from msgs where kind='team'),
team_burst as (
  select *, sum(case when prev_sent is null or sent_at - prev_sent > (p_bwin * interval '1 second') then 1 else 0 end)
             over (partition by person order by sent_at, id) as bcluster
  from (select *, lag(sent_at) over (partition by person order by sent_at, id) as prev_sent from team_all) t
),
bstats as (select person, bcluster, count(distinct contact_id) as ngroups from team_burst group by person, bcluster),
team_marked as (
  select tb.id, tb.person, tb.bcluster, tb.contact_id, tb.digisac_user_id, tb.sent_at,
         bs.ngroups, (bs.ngroups >= p_bmin) as is_bcast
  from team_burst tb join bstats bs using (person, bcluster)
),
bcast_contrib as (
  select (min(sent_at) at time zone 'America/Sao_Paulo')::date as day,
         contact_id, digisac_user_id,
         (p_floor / max(ngroups))::numeric as minutes, count(*)::int as broadcast_msgs
  from team_marked where is_bcast
  group by person, bcluster, contact_id, digisac_user_id
),
sess_src as (
  select id, contact_id, digisac_user_id, sent_at, 'client'::text as kind from msgs where kind='client'
  union all
  select id, contact_id, digisac_user_id, sent_at, 'team'::text as kind from team_marked where not is_bcast
),
sess_lag as (select *, lag(sent_at) over w as prev_sent, lag(kind) over w as prev_kind from sess_src window w as (partition by contact_id order by sent_at, id)),
seq as (
  select *, sum(case when prev_sent is null or sent_at - prev_sent > (p_gap * interval '1 minute') then 1 else 0 end)
             over (partition by contact_id order by sent_at, id) as seq_id
  from sess_lag
),
team_in_seq as (
  select contact_id, seq_id, sent_at, prev_kind, id, digisac_user_id, coalesce(digisac_user_id,'') as person,
         row_number() over (partition by contact_id, seq_id, coalesce(digisac_user_id,'') order by sent_at, id) as rn
  from seq where kind='team'
),
sessions_raw as (
  select contact_id, seq_id, person, min(digisac_user_id) as digisac_user_id,
         min(sent_at) as first_ts, max(sent_at) as last_ts, count(*)::int as team_msgs,
         max(case when rn=1 then prev_kind end) as first_prev_kind
  from team_in_seq group by contact_id, seq_id, person
),
sess_flag as (
  select contact_id, seq_id, person, digisac_user_id, team_msgs,
         first_ts - (case when first_prev_kind='client' then p_prep else 0 end) * interval '1 minute' as start_ts,
         last_ts + p_floor * interval '1 minute' as end_ts,
         (first_ts at time zone 'America/Sao_Paulo')::date as day,
         ((last_ts + p_floor * interval '1 minute') - (first_ts - (case when first_prev_kind='client' then p_prep else 0 end) * interval '1 minute')) > (p_long * interval '1 minute') as is_long
  from sessions_raw
),
events as (select person, start_ts as t, 1 as d from sess_flag union all select person, end_ts as t, -1 as d from sess_flag),
bpts as (select person, t, sum(d) as delta from events group by person, t),
bk as (select person, t, sum(delta) over (partition by person order by t rows between unbounded preceding and current row) as k_after, lead(t) over (partition by person order by t) as next_t from bpts),
seg_contrib as (select person, t, case when next_t is not null and k_after>0 then extract(epoch from (next_t-t))/60.0/k_after else 0 end as seg_eff from bk),
fvals as (select person, t, (person||'#'||extract(epoch from t)::text) as pk, coalesce(sum(seg_eff) over (partition by person order by t rows between unbounded preceding and 1 preceding),0) as f from seg_contrib),
sess_eff as (
  select sf.contact_id, sf.seq_id, sf.person, sf.digisac_user_id, sf.day, sf.is_long, sf.team_msgs,
         sf.start_ts, sf.end_ts, (fe.f - fs.f) as minutes
  from sess_flag sf
  join fvals fs on fs.pk = sf.person||'#'||extract(epoch from sf.start_ts)::text
  join fvals fe on fe.pk = sf.person||'#'||extract(epoch from sf.end_ts)::text
),
-- mensagens do cliente por sessão (pessoa do último atendimento na sequência)
client_person as (
  select contact_id, seq_id, id, sent_at, kind, digisac_user_id,
         sum(case when kind='team' then 1 else 0 end) over (partition by contact_id, seq_id order by sent_at, id rows between unbounded preceding and current row) as tseen
  from seq
),
client_grp as (
  select contact_id, seq_id, kind, tseen,
         coalesce(first_value(digisac_user_id) over (partition by contact_id, seq_id, tseen order by sent_at, id),'') as person
  from client_person
),
client_per_session as (
  select contact_id, seq_id, person, count(*)::int as cmsgs
  from client_grp where kind='client' and tseen >= 1
  group by contact_id, seq_id, person
),
sess_rows as (
  select se.day, se.contact_id, se.digisac_user_id, se.start_ts as started_at, se.end_ts as ended_at,
         se.minutes, se.team_msgs, coalesce(cps.cmsgs,0) as client_msgs, se.is_long,
         false as is_broadcast, 0 as broadcast_msgs
  from sess_eff se
  left join client_per_session cps
    on (cps.contact_id||'#'||cps.seq_id||'#'||cps.person) = (se.contact_id||'#'||se.seq_id||'#'||se.person)
),
broadcast_rows as (
  select day, contact_id, digisac_user_id, null::timestamptz as started_at, null::timestamptz as ended_at,
         minutes, 0 as team_msgs, 0 as client_msgs, false as is_long,
         true as is_broadcast, broadcast_msgs
  from bcast_contrib
)
select day, contact_id, digisac_user_id, started_at, ended_at, minutes, team_msgs, client_msgs, is_long, is_broadcast, broadcast_msgs
  from sess_rows where day between p_from and p_to
union all
select day, contact_id, digisac_user_id, started_at, ended_at, minutes, team_msgs, client_msgs, is_long, is_broadcast, broadcast_msgs
  from broadcast_rows where day between p_from and p_to;
$$;

-- ---------------------------------------------------------------------
-- 4) attendance_compute: AGREGADO por (dia, grupo, pessoa) — agora um fino
--    agregador da fonte única (usado para sensibilidade e leituras). Mesmos
--    totais de MINUTOS de antes (soma em precisão cheia, arredonda no fim).
-- ---------------------------------------------------------------------
create or replace function attendance_compute(
  p_from date, p_to date,
  p_gap integer, p_floor numeric, p_prep numeric,
  p_long integer, p_bmin integer, p_bwin integer
)
returns table(
  day date, contact_id text, digisac_user_id text,
  minutes numeric, sessions integer, team_msgs integer, client_msgs integer,
  long_sessions integer, broadcast_msgs integer
)
language sql stable set search_path = public
as $$
  select day, contact_id, digisac_user_id,
         round(sum(minutes), 2) as minutes,
         count(*) filter (where not is_broadcast)::int as sessions,
         coalesce(sum(team_msgs) filter (where not is_broadcast), 0)::int as team_msgs,
         coalesce(sum(client_msgs) filter (where not is_broadcast), 0)::int as client_msgs,
         coalesce(sum(case when is_long then 1 else 0 end), 0)::int as long_sessions,
         coalesce(sum(broadcast_msgs), 0)::int as broadcast_msgs
    from attendance_sessions_compute(p_from, p_to, p_gap, p_floor, p_prep, p_long, p_bmin, p_bwin)
   group by day, contact_id, digisac_user_id;
$$;

-- ---------------------------------------------------------------------
-- 5) Recálculo: grava SESSÕES (com sobreposição de tarefa) e deriva estimates.
--    Sobreposição: une (merge) os time_entries da pessoa p/ não contar em dobro
--    (eles se sobrepõem no histórico), e intersecta com a sessão. O valor é
--    proporcional a minutes (overlap = minutes * seg_sobreposto / duração_bruta),
--    então nunca passa de minutes. Três recortes: qualquer tarefa; tarefa da MESMA
--    empresa do grupo; tarefa 'Controle de Conta' (pelo título da instância).
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

  -- (a) fonte: sessões + comunicado colado (com sid para juntar a sobreposição).
  drop table if exists _rows;
  create temp table _rows as
    select row_number() over () as sid, *
      from attendance_sessions_compute(p_from, p_to, r.gap_minutes, r.floor_minutes,
                                       r.prep_minutes, r.long_session_minutes,
                                       r.broadcast_min_groups, r.broadcast_window_seconds);
  create index on _rows (sid);
  analyze _rows;

  -- (b) uma empresa por contato (prioriza grupo ativo).
  drop table if exists _cfc;
  create temp table _cfc as
    select distinct on (c.whatsapp_contact_id)
           c.whatsapp_contact_id as contact_id, c.id as company_id
      from companies c left join company_groups g on g.id = c.group_id
     where c.whatsapp_contact_id is not null
     order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id;
  create index on _cfc (contact_id);
  analyze _cfc;

  -- (c) sessões (não comunicado) mapeadas à pessoa (collaborator) e empresa.
  drop table if exists _ss;
  create temp table _ss as
    select rw.sid, rw.started_at, rw.ended_at, du.profile_id as collab, cfc.company_id as sess_company
      from _rows rw
      join digisac_users du on du.id = rw.digisac_user_id
      left join _cfc cfc on cfc.contact_id = rw.contact_id
     where not rw.is_broadcast and du.profile_id is not null and rw.ended_at > rw.started_at;
  create index on _ss (collab);
  analyze _ss;

  -- (d) time_entries das pessoas relevantes, com empresa e flag de Controle de Conta.
  drop table if exists _te;
  create temp table _te as
    select te.collaborator_id as collab, ti.company_id, (ti.title = 'Controle de Conta') as is_cc,
           te.started_at as lo, coalesce(te.ended_at, now()) as hi
      from time_entries te
      join task_instances ti on ti.id = te.task_id
     where coalesce(te.ended_at, now()) > te.started_at
       and te.collaborator_id in (select distinct collab from _ss);
  analyze _te;

  -- (e) merge (união) de intervalos — por pessoa; por (pessoa,empresa); CC por pessoa.
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

  -- (f) segundos sobrepostos por sessão (sobre intervalos já unidos → sem dobro).
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

  -- (g) grava as sessões (overlap proporcional a minutes; nunca passa de minutes).
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

  -- (h) deriva attendance_estimates (sessões + comunicado). Minutos idênticos a antes.
  delete from attendance_estimates where day between p_from and p_to;
  insert into attendance_estimates
    (day, contact_id, digisac_user_id, minutes, sessions, team_msgs, client_msgs,
     long_sessions, broadcast_msgs, overlap_task_minutes, overlap_same_company_minutes,
     overlap_controle_conta_minutes, computed_at)
  select rw.day, rw.contact_id, rw.digisac_user_id,
         round(sum(rw.minutes), 2) as minutes,
         count(*) filter (where not rw.is_broadcast)::int as sessions,
         coalesce(sum(rw.team_msgs) filter (where not rw.is_broadcast), 0)::int as team_msgs,
         coalesce(sum(rw.client_msgs) filter (where not rw.is_broadcast), 0)::int as client_msgs,
         coalesce(sum(case when rw.is_long then 1 else 0 end), 0)::int as long_sessions,
         coalesce(sum(rw.broadcast_msgs), 0)::int as broadcast_msgs,
         round(coalesce(sum(coalesce(o.raw_all,0) / nullif(extract(epoch from (rw.ended_at - rw.started_at)),0) * rw.minutes), 0), 2),
         round(coalesce(sum(coalesce(o.raw_co ,0) / nullif(extract(epoch from (rw.ended_at - rw.started_at)),0) * rw.minutes), 0), 2),
         round(coalesce(sum(coalesce(o.raw_cc ,0) / nullif(extract(epoch from (rw.ended_at - rw.started_at)),0) * rw.minutes), 0), 2),
         now()
    from _rows rw left join _ov o on o.sid = rw.sid
   group by rw.day, rw.contact_id, rw.digisac_user_id;

  drop table if exists _rows; drop table if exists _cfc; drop table if exists _ss;
  drop table if exists _te; drop table if exists _te_all; drop table if exists _te_co;
  drop table if exists _te_cc; drop table if exists _ov;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) Comparação (admin): "Estimado" ganha versão FORA de tarefa (padrão da tela),
--    + chat dentro do Controle de Conta e tempo cronometrado do Controle de Conta.
--    REGRA p/ capacidade: a carga de atendimento é est_out_task (minutes -
--    overlap_task); o chat dentro de tarefa é só informação.
-- ---------------------------------------------------------------------
drop function if exists attendance_comparison(date, date, text, boolean);
create or replace function attendance_comparison(
  p_start date, p_end date, p_bucket text, p_exclude_auto boolean
)
returns table(
  profile_id uuid, user_name text,
  company_id uuid, company_number text, company_name text,
  bucket date,
  timed_minutes numeric, est_minutes numeric, est_out_task_minutes numeric,
  cc_chat_minutes numeric, cc_timed_minutes numeric
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
         sum(es.overlap_controle_conta_minutes) as cc_chat_minutes
    from attendance_estimates es
    join digisac_users du on du.id = es.digisac_user_id
    join enabled e on e.profile_id = du.profile_id
    join comp_for_contact cf on cf.contact_id = es.contact_id
   where (p_start is null or es.day >= p_start) and (p_end is null or es.day <= p_end)
   group by e.profile_id, e.full_name, cf.company_id, bucket
),
-- tempo cronometrado das tarefas 'Controle de Conta' da pessoa, por empresa/balde.
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
       round(coalesce(t.timed_minutes,0), 2)        as timed_minutes,
       round(coalesce(x.est_minutes,0), 2)          as est_minutes,
       round(coalesce(x.est_out_task_minutes,0), 2) as est_out_task_minutes,
       round(coalesce(x.cc_chat_minutes,0), 2)      as cc_chat_minutes,
       round(coalesce(cc.cc_timed_minutes,0), 2)    as cc_timed_minutes
  from (select distinct profile_id, company_id, bucket from keys) k
  left join timed t   using (profile_id, company_id, bucket)
  left join est   x   using (profile_id, company_id, bucket)
  left join cc_timed cc using (profile_id, company_id, bucket)
  left join companies c on c.id = k.company_id
 where (select is_admin())
 order by user_name, c.name, k.bucket;
$$;

-- ---------------------------------------------------------------------
-- 7) Linha do tempo de um dia/pessoa (admin): sessões estimadas + atendimentos
--    cronometrados, em ordem de horário, para conferência contato a contato.
-- ---------------------------------------------------------------------
create or replace function attendance_day_timeline(p_day date, p_profile_id uuid)
returns table(
  kind text, company_number text, company_name text,
  started_at timestamptz, ended_at timestamptz,
  minutes numeric, team_msgs integer, client_msgs integer, in_task boolean, auto_closed boolean
)
language sql stable security definer set search_path = public
as $$
with
comp_for_contact as (
  select distinct on (c.whatsapp_contact_id) c.whatsapp_contact_id as contact_id, c.id as company_id
    from companies c left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind='active') desc nulls last, c.created_at, c.id
),
sess as (
  select 'estimada'::text as kind, c.id as company_id, c.name,
         s.started_at, s.ended_at, s.minutes, s.team_msgs, s.client_msgs,
         (s.overlap_task_minutes > 0) as in_task, false as auto_closed
    from attendance_sessions s
    join digisac_users du on du.id = s.digisac_user_id
    left join comp_for_contact cf on cf.contact_id = s.contact_id
    left join companies c on c.id = cf.company_id
   where s.day = p_day and du.profile_id = p_profile_id
),
cron as (
  select 'cronometro'::text as kind, c.id as company_id, c.name,
         ae.started_at, ae.ended_at,
         round(extract(epoch from (coalesce(ae.ended_at, now()) - ae.started_at))/60.0, 2) as minutes,
         null::int as team_msgs, null::int as client_msgs, null::boolean as in_task, ae.auto_closed
    from attendance_entries ae
    join companies c on c.id = ae.company_id
   where ae.user_id = p_profile_id
     and (ae.started_at at time zone 'America/Sao_Paulo')::date = p_day
)
select kind, substring(name from '^\s*(\d+)') as company_number, name as company_name,
       started_at, ended_at, minutes, team_msgs, client_msgs, in_task, auto_closed
  from (select * from sess union all select * from cron) u
 where (select is_admin())
 order by started_at;
$$;

grant execute on function attendance_comparison(date, date, text, boolean) to authenticated;
grant execute on function attendance_day_timeline(date, uuid)             to authenticated;
-- attendance_compute e attendance_sessions_compute NÃO são concedidas a authenticated.
