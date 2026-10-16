-- =====================================================================
-- CRM/Timer - Monvatti :: Estimativa de ATENDIMENTO (Digisac) — ETAPA 2
-- =====================================================================
-- Calcula o tempo ESTIMADO de atendimento por pessoa, por grupo (empresa) e por
-- dia, a partir dos metadados das mensagens (etapa 1), com parâmetros editáveis.
-- A página de calibração compara "estimado x cronometrado" dos dois Marcos.
--
-- PRIVACIDADE: NUNCA usamos o texto das mensagens. A coluna text_hash da etapa 1
-- é removida aqui; a detecção de "comunicado colado" é só por PADRÃO DE HORÁRIO.
--
-- Tudo set-based (funções de janela + comandos em conjunto). Sem laço linha a
-- linha. A materialização mora em attendance_estimates; o cálculo puro, por
-- parâmetros arbitrários, em attendance_compute(...) — usado também para análises
-- de sensibilidade sem tocar os parâmetros oficiais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Limpeza da etapa 1: fora o text_hash e tudo que dependia de texto.
-- ---------------------------------------------------------------------
alter table digisac_messages drop column if exists text_hash;

-- ---------------------------------------------------------------------
-- 1) Ligação pessoa (digisac_user -> perfil): casamento por e-mail na
--    sincronização, com TRAVA para a ligação manual não ser sobrescrita.
-- ---------------------------------------------------------------------
alter table digisac_users
  add column if not exists profile_locked boolean not null default false;

-- Gatilho: enquanto NÃO travado, profile_id é (re)calculado por e-mail. Travado
-- (ligação manual, inclusive "nenhum" = null), mantém o que o admin definiu.
create or replace function digisac_users_match()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not coalesce(new.profile_locked, false) then
    select p.id into new.profile_id
      from profiles p
     where new.email is not null and lower(p.email) = lower(new.email)
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists digisac_users_match_tg on digisac_users;
create trigger digisac_users_match_tg
  before insert or update on digisac_users
  for each row execute function digisac_users_match();

-- RPC admin: lista usuários do Digisac com volume e ligação atual.
create or replace function digisac_users_admin_list()
returns table(
  id text, digisac_name text, email text, msgs bigint,
  profile_id uuid, profile_name text, profile_locked boolean
)
language sql stable security definer set search_path = public
as $$
  with vol as (
    select digisac_user_id, count(*) as n
      from digisac_messages where digisac_user_id is not null
     group by digisac_user_id
  )
  select u.id, u.name, u.email, coalesce(v.n, 0) as msgs,
         u.profile_id, p.full_name, u.profile_locked
    from digisac_users u
    left join vol v on v.digisac_user_id = u.id
    left join profiles p on p.id = u.profile_id
   where (select is_admin())
   order by coalesce(v.n, 0) desc, u.name;
$$;

-- RPC admin: define a ligação. p_auto=true volta ao automático (destrava e o
-- gatilho recasa por e-mail); senão trava em p_profile_id (null = "nenhum").
create or replace function digisac_set_user_link(
  p_user_id text, p_profile_id uuid, p_auto boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'apenas administradores';
  end if;
  if p_auto then
    update digisac_users set profile_locked = false, updated_at = now()
     where id = p_user_id;              -- gatilho recasa por e-mail
  else
    update digisac_users
       set profile_id = p_profile_id, profile_locked = true, updated_at = now()
     where id = p_user_id;
  end if;
  if not found then
    raise exception 'usuário Digisac não encontrado';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Parâmetros (uma linha, admin-only). Salvar dispara o recálculo completo.
-- ---------------------------------------------------------------------
create table if not exists attendance_params (
  id                      boolean primary key default true check (id),
  gap_minutes             integer       not null default 10,
  floor_minutes           numeric(6,2)  not null default 2,
  prep_minutes            numeric(6,2)  not null default 3,
  long_session_minutes    integer       not null default 60,
  broadcast_min_groups    integer       not null default 3,
  broadcast_window_seconds integer      not null default 60,
  updated_at              timestamptz   not null default now(),
  updated_by              uuid references profiles(id) on delete set null
);
insert into attendance_params (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3) Resultado materializado (por contact_id; empresa resolvida na leitura).
-- ---------------------------------------------------------------------
create table if not exists attendance_estimates (
  day             date    not null,
  contact_id      text    not null,
  digisac_user_id text,                      -- null = equipe não identificada
  minutes         numeric(10,2) not null default 0,
  sessions        integer not null default 0,
  team_msgs       integer not null default 0,
  client_msgs     integer not null default 0,
  long_sessions   integer not null default 0,
  broadcast_msgs  integer not null default 0,
  computed_at     timestamptz not null default now()
);
create unique index if not exists attendance_estimates_key
  on attendance_estimates (day, contact_id, coalesce(digisac_user_id, ''));
create index if not exists attendance_estimates_day_idx
  on attendance_estimates (day);
create index if not exists attendance_estimates_user_idx
  on attendance_estimates (digisac_user_id);

-- ---------------------------------------------------------------------
-- 4) RLS: admin-only em params e estimates (leitura real via RPC DEFINER).
-- ---------------------------------------------------------------------
alter table attendance_params    enable row level security;
alter table attendance_estimates enable row level security;

drop policy if exists ap_select on attendance_params;
create policy ap_select on attendance_params    for select using ((select is_admin()));
drop policy if exists aes_select on attendance_estimates;
create policy aes_select on attendance_estimates for select using ((select is_admin()));

grant select on attendance_params, attendance_estimates to authenticated;

-- ---------------------------------------------------------------------
-- 5) NÚCLEO DO CÁLCULO — puro, por parâmetros arbitrários, set-based.
--    Janela [p_from-1, p_to+1] (BRT) para fechar sequências na virada do dia;
--    atribui ao dia BRT do INÍCIO da sessão; o chamador descarta fora da faixa.
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
with
bounds as (
  select ((p_from - 1)::timestamp at time zone 'America/Sao_Paulo') as lo,
         ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo') as hi
),
-- Classificação. Equipe: minha, visível, não-bot, origin<>'bot', não-comentário.
-- Cliente: não minha, visível, não-comentário. Demais ficam de fora das sequências.
base as (
  select m.id, m.contact_id, m.digisac_user_id, m.sent_at,
    case
      when coalesce(m.is_from_me,false) and coalesce(m.visible,true)
           and not coalesce(m.is_from_bot,false) and coalesce(m.origin,'') <> 'bot'
           and not coalesce(m.is_comment,false)
        then 'team'
      when not coalesce(m.is_from_me,false) and coalesce(m.visible,true)
           and not coalesce(m.is_comment,false)
        then 'client'
      else null
    end as kind
  from digisac_messages m
  cross join bounds b
  where m.sent_at >= b.lo and m.sent_at < b.hi
),
msgs as (select * from base where kind is not null),

-- ---- Comunicado colado (por horário): a MESMA pessoa em >= p_bmin grupos
--      dentro de uma rajada (consecutivas a <= p_bwin segundos). ----
team_all as (
  select id, contact_id, digisac_user_id, sent_at,
         coalesce(digisac_user_id, '') as person
    from msgs where kind = 'team'
),
team_burst as (
  select *,
    sum(case when prev_sent is null
                 or sent_at - prev_sent > (p_bwin * interval '1 second')
             then 1 else 0 end)
      over (partition by person order by sent_at, id) as bcluster
  from (
    select *, lag(sent_at) over (partition by person order by sent_at, id) as prev_sent
      from team_all
  ) t
),
bstats as (
  select person, bcluster, count(distinct contact_id) as ngroups
    from team_burst group by person, bcluster
),
-- Cada mensagem da equipe com o flag de comunicado colado (sem anti-join depois).
team_marked as (
  select tb.id, tb.person, tb.bcluster, tb.contact_id, tb.digisac_user_id, tb.sent_at,
         bs.ngroups, (bs.ngroups >= p_bmin) as is_bcast
    from team_burst tb
    join bstats bs using (person, bcluster)
),
bcast_contrib as (        -- UM piso por rajada, dividido igualmente entre os grupos
  select (min(sent_at) at time zone 'America/Sao_Paulo')::date as day,
         contact_id, digisac_user_id,
         (p_floor / max(ngroups))::numeric as minutes,
         count(*)::int as broadcast_msgs
    from team_marked
   where is_bcast
   group by person, bcluster, contact_id, digisac_user_id
),
bcast_agg as (
  select day, contact_id, digisac_user_id,
         sum(minutes) as minutes, sum(broadcast_msgs)::int as broadcast_msgs
    from bcast_contrib
   group by day, contact_id, digisac_user_id
),

-- ---- Sequências (equipe não-comunicado + cliente); cliente faz ponte. ----
sess_src as (
  select id, contact_id, digisac_user_id, sent_at, 'client'::text as kind
    from msgs where kind = 'client'
  union all
  select id, contact_id, digisac_user_id, sent_at, 'team'::text as kind
    from team_marked where not is_bcast
),
sess_lag as (
  select *,
    lag(sent_at) over w as prev_sent,
    lag(kind)    over w as prev_kind
  from sess_src
  window w as (partition by contact_id order by sent_at, id)
),
seq as (
  select *,
    sum(case when prev_sent is null
                 or sent_at - prev_sent > (p_gap * interval '1 minute')
             then 1 else 0 end)
      over (partition by contact_id order by sent_at, id) as seq_id
  from sess_lag
),
-- Sessão da pessoa na sequência: da 1ª à última mensagem DELA; prep só se o que
-- veio antes no grupo (a qualquer distância) foi do cliente.
team_in_seq as (
  select contact_id, seq_id, sent_at, prev_kind, id,
         digisac_user_id, coalesce(digisac_user_id,'') as person,
         row_number() over (partition by contact_id, seq_id, coalesce(digisac_user_id,'')
                            order by sent_at, id) as rn
    from seq where kind = 'team'
),
sessions_raw as (
  select contact_id, seq_id, person,
         min(digisac_user_id) as digisac_user_id,
         min(sent_at) as first_ts, max(sent_at) as last_ts,
         count(*)::int as team_msgs,
         max(case when rn = 1 then prev_kind end) as first_prev_kind
    from team_in_seq
   group by contact_id, seq_id, person
),
sess_flag as (
  select contact_id, seq_id, person, digisac_user_id, team_msgs, first_ts, last_ts,
         first_ts - (case when first_prev_kind = 'client' then p_prep else 0 end) * interval '1 minute' as start_ts,
         last_ts + p_floor * interval '1 minute' as end_ts,
         (first_ts at time zone 'America/Sao_Paulo')::date as day,
         ((last_ts + p_floor * interval '1 minute')
            - (first_ts - (case when first_prev_kind='client' then p_prep else 0 end) * interval '1 minute'))
           > (p_long * interval '1 minute') as is_long,
         row_number() over () as sid
    from sessions_raw
),

-- ---- Sobreposição: minutos simultâneos da pessoa divididos entre os grupos. ----
-- Varredura por pessoa (sweep-line): em cada instante com k sessões ativas, o
-- minuto vale 1/k por sessão. F(t) = integral acumulada de 1/k; o tempo efetivo
-- de uma sessão é F(fim) - F(início). O(n log n), sem join quadrático. Garante,
-- por construção, que a soma da pessoa = tempo de calendário das sessões unidas
-- (nos trechos sem sessão k=0 e a contribuição é zero, então as "ilhas" separadas
-- não se misturam).
events as (
  select person, start_ts as t, 1 as d from sess_flag
  union all
  select person, end_ts   as t, -1 as d from sess_flag
),
bpts as (
  select person, t, sum(d) as delta from events group by person, t
),
bk as (
  select person, t,
    sum(delta) over (partition by person order by t
                     rows between unbounded preceding and current row) as k_after,
    lead(t) over (partition by person order by t) as next_t
  from bpts
),
seg_contrib as (
  select person, t,
    case when next_t is not null and k_after > 0
         then extract(epoch from (next_t - t)) / 60.0 / k_after
         else 0 end as seg_eff
  from bk
),
fvals as (
  select person, t,
    (person || '#' || extract(epoch from t)::text) as pk,   -- chave composta única
    coalesce(sum(seg_eff) over (partition by person order by t
                                rows between unbounded preceding and 1 preceding), 0) as f
  from seg_contrib
),
-- Junta F por chave composta (pessoa#epoch): equi-join exato, sem o merge-join
-- degenerado que explodiria ao casar só por pessoa.
sess_eff as (
  select sf.sid, sf.contact_id, sf.digisac_user_id, sf.day, sf.is_long, sf.team_msgs,
         (fe.f - fs.f) as eff_minutes
    from sess_flag sf
    join fvals fs on fs.pk = sf.person || '#' || extract(epoch from sf.start_ts)::text
    join fvals fe on fe.pk = sf.person || '#' || extract(epoch from sf.end_ts)::text
),
sess_agg as (
  select day, contact_id, digisac_user_id,
         sum(eff_minutes) as minutes,
         count(*)::int as sessions,
         sum(team_msgs)::int as team_msgs,
         sum(case when is_long then 1 else 0 end)::int as long_sessions
    from sess_eff
   group by day, contact_id, digisac_user_id
),

-- ---- Mensagens do cliente (diagnóstico): atribuídas à pessoa do último
--      atendimento da equipe na MESMA sequência (via janela, sem join por faixa).
--      tseen = quantas mensagens da equipe já ocorreram na sequência; dentro de um
--      mesmo (seq, tseen) a 1ª linha é a mensagem da equipe que abriu o trecho.
client_person as (
  select contact_id, seq_id, id, sent_at, kind, digisac_user_id,
         sum(case when kind = 'team' then 1 else 0 end)
           over (partition by contact_id, seq_id order by sent_at, id
                 rows between unbounded preceding and current row) as tseen
    from seq
),
client_grp as (
  select contact_id, sent_at, kind, tseen,
         first_value(digisac_user_id)
           over (partition by contact_id, seq_id, tseen order by sent_at, id) as uid
    from client_person
),
-- Dia da própria mensagem do cliente e a pessoa atribuída (sem join com as
-- sessões — evita o nested loop). tseen>=1 garante que já houve equipe na sequência.
client_counts as (
  select (sent_at at time zone 'America/Sao_Paulo')::date as day,
         contact_id, uid as digisac_user_id, count(*)::int as client_msgs
    from client_grp
   where kind = 'client' and tseen >= 1
   group by (sent_at at time zone 'America/Sao_Paulo')::date, contact_id, uid
),

-- ---- Junção final (chave day, contact_id, digisac_user_id com null). ----
keys as (
  select day, contact_id, digisac_user_id from sess_agg
  union
  select day, contact_id, digisac_user_id from client_counts
  union
  select day, contact_id, digisac_user_id from bcast_agg
)
select k.day, k.contact_id, k.digisac_user_id,
       round(coalesce(sa.minutes,0) + coalesce(ba.minutes,0), 2) as minutes,
       coalesce(sa.sessions,0) as sessions,
       coalesce(sa.team_msgs,0) as team_msgs,
       coalesce(cc.client_msgs,0) as client_msgs,
       coalesce(sa.long_sessions,0) as long_sessions,
       coalesce(ba.broadcast_msgs,0) as broadcast_msgs
  from keys k
  left join sess_agg sa
    on sa.day=k.day and sa.contact_id=k.contact_id
   and sa.digisac_user_id is not distinct from k.digisac_user_id
  left join client_counts cc
    on cc.day=k.day and cc.contact_id=k.contact_id
   and cc.digisac_user_id is not distinct from k.digisac_user_id
  left join bcast_agg ba
    on ba.day=k.day and ba.contact_id=k.contact_id
   and ba.digisac_user_id is not distinct from k.digisac_user_id
 where k.day between p_from and p_to;
$$;

-- ---------------------------------------------------------------------
-- 6) Recálculo materializado (idempotente): apaga a faixa e recalcula.
--    Interno — não é concedido a authenticated (só cron, trigger e wrappers).
-- ---------------------------------------------------------------------
create or replace function recompute_attendance(p_from date, p_to date)
returns void
language plpgsql security definer
  set search_path = public
  set statement_timeout = '240s'   -- recálculo completo passa do limite padrão
as $$
declare r attendance_params%rowtype;
begin
  select * into r from attendance_params limit 1;
  delete from attendance_estimates where day between p_from and p_to;
  insert into attendance_estimates
    (day, contact_id, digisac_user_id, minutes, sessions, team_msgs,
     client_msgs, long_sessions, broadcast_msgs, computed_at)
  select day, contact_id, digisac_user_id, minutes, sessions, team_msgs,
         client_msgs, long_sessions, broadcast_msgs, now()
    from attendance_compute(p_from, p_to, r.gap_minutes, r.floor_minutes,
                            r.prep_minutes, r.long_session_minutes,
                            r.broadcast_min_groups, r.broadcast_window_seconds);
end;
$$;

-- ---------------------------------------------------------------------
-- 7) Leitura e edição dos parâmetros (admin). Salvar recalcula desde 01/09/2026.
-- ---------------------------------------------------------------------
create or replace function attendance_params_get()
returns setof attendance_params
language sql stable security definer set search_path = public
as $$
  select * from attendance_params where (select is_admin()) limit 1;
$$;

create or replace function attendance_params_save(
  p_gap integer, p_floor numeric, p_prep numeric,
  p_long integer, p_bmin integer, p_bwin integer
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'apenas administradores';
  end if;
  if p_gap < 1 or p_floor < 0 or p_prep < 0 or p_long < 1
     or p_bmin < 2 or p_bwin < 1 then
    raise exception 'parâmetros inválidos';
  end if;
  update attendance_params
     set gap_minutes = p_gap, floor_minutes = p_floor, prep_minutes = p_prep,
         long_session_minutes = p_long, broadcast_min_groups = p_bmin,
         broadcast_window_seconds = p_bwin,
         updated_at = now(), updated_by = auth.uid()
   where id;
  perform recompute_attendance(date '2026-09-01', (now() at time zone 'America/Sao_Paulo')::date);
end;
$$;

create or replace function attendance_recompute_all()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'apenas administradores';
  end if;
  perform recompute_attendance(date '2026-09-01', (now() at time zone 'America/Sao_Paulo')::date);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Comparação estimado x cronometrado (admin) para os dois Marcos.
--    Por empresa e balde (dia/semana/mês BRT). Um lado pode faltar (full join).
-- ---------------------------------------------------------------------
create or replace function attendance_comparison(
  p_start date, p_end date, p_bucket text, p_exclude_auto boolean
)
returns table(
  profile_id uuid, user_name text,
  company_id uuid, company_number text, company_name text,
  bucket date, timed_minutes numeric, est_minutes numeric
)
language sql stable security definer set search_path = public
as $$
with
enabled as (
  select id as profile_id, full_name from profiles where attendance_timer_enabled
),
-- Uma empresa por contato (prioriza grupo ativo, depois a mais antiga).
comp_for_contact as (
  select distinct on (c.whatsapp_contact_id)
         c.whatsapp_contact_id as contact_id, c.id as company_id
    from companies c
    left join company_groups g on g.id = c.group_id
   where c.whatsapp_contact_id is not null
   order by c.whatsapp_contact_id, (g.kind = 'active') desc nulls last, c.created_at, c.id
),
timed as (
  select e.profile_id, e.full_name as user_name, ae.company_id,
         case lower(coalesce(p_bucket,'day'))
           when 'week'  then date_trunc('week',  x.d)::date
           when 'month' then date_trunc('month', x.d)::date
           else x.d end as bucket,
         sum(extract(epoch from (coalesce(ae.ended_at, now()) - ae.started_at)) / 60.0) as timed_minutes
    from attendance_entries ae
    join enabled e on e.profile_id = ae.user_id
    cross join lateral (select (ae.started_at at time zone 'America/Sao_Paulo')::date as d) x
   where (not p_exclude_auto or not ae.auto_closed)
     and (p_start is null or x.d >= p_start)
     and (p_end   is null or x.d <= p_end)
   group by e.profile_id, e.full_name, ae.company_id, bucket
),
est as (
  select e.profile_id, e.full_name as user_name, cf.company_id,
         case lower(coalesce(p_bucket,'day'))
           when 'week'  then date_trunc('week',  es.day)::date
           when 'month' then date_trunc('month', es.day)::date
           else es.day end as bucket,
         sum(es.minutes) as est_minutes
    from attendance_estimates es
    join digisac_users du on du.id = es.digisac_user_id
    join enabled e on e.profile_id = du.profile_id
    join comp_for_contact cf on cf.contact_id = es.contact_id
   where (p_start is null or es.day >= p_start)
     and (p_end   is null or es.day <= p_end)
   group by e.profile_id, e.full_name, cf.company_id, bucket
),
keys as (
  select profile_id, user_name, company_id, bucket from timed
  union
  select profile_id, user_name, company_id, bucket from est
)
select k.profile_id, k.user_name, k.company_id,
       substring(c.name from '^\s*(\d+)') as company_number,
       c.name as company_name,
       k.bucket,
       round(coalesce(t.timed_minutes, 0), 2) as timed_minutes,
       round(coalesce(x.est_minutes, 0), 2)   as est_minutes
  from keys k
  left join timed t using (profile_id, user_name, company_id, bucket)
  left join est   x using (profile_id, user_name, company_id, bucket)
  left join companies c on c.id = k.company_id
 where (select is_admin())
 order by k.user_name, c.name, k.bucket;
$$;

-- ---------------------------------------------------------------------
-- 9) Grants (autorização real por dentro de cada função).
-- ---------------------------------------------------------------------
grant execute on function digisac_users_admin_list()                                to authenticated;
grant execute on function digisac_set_user_link(text, uuid, boolean)                to authenticated;
grant execute on function attendance_params_get()                                   to authenticated;
grant execute on function attendance_params_save(integer, numeric, numeric, integer, integer, integer) to authenticated;
grant execute on function attendance_recompute_all()                                to authenticated;
grant execute on function attendance_comparison(date, date, text, boolean)          to authenticated;
-- attendance_compute e recompute_attendance NÃO são concedidas a authenticated.

-- ---------------------------------------------------------------------
-- 10) Cron: recalcula os últimos 3 dias no minuto 20 de cada hora. O recálculo
--     completo só ao salvar parâmetros ou pelo botão admin "Recalcular tudo".
-- ---------------------------------------------------------------------
select cron.unschedule('attendance-estimates-recompute')
 where exists (select 1 from cron.job where jobname = 'attendance-estimates-recompute');
select cron.schedule(
  'attendance-estimates-recompute',
  '20 * * * *',
  $cron$
  select public.recompute_attendance(
    (now() at time zone 'America/Sao_Paulo')::date - 2,
    (now() at time zone 'America/Sao_Paulo')::date
  );
  $cron$
);
