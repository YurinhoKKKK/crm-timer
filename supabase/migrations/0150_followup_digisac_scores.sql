-- =====================================================================
-- 0150 — Acompanhamento e Pontuação por CONTATO do Digisac
-- =====================================================================
-- O contato com o cliente passa a ser medido SÓ pelas mensagens do Digisac
-- (digisac_messages), não mais por ações no CRM. Novo sistema de pontos por dia e
-- por colaborador; o quadro de Acompanhamento e as colunas da Capacidade usam a
-- mesma definição de contato. LGPD: nunca se lê nem se guarda texto de mensagem.
--
-- DECISÕES (não reabrir) — resumo do que o banco garante:
--  (1) Contato válido = is_from_me ∧ ¬is_from_bot ∧ ¬is_comment (qualquer pessoa
--      da Monvatti; mensagem do cliente não conta).
--  (2) Massa: se o mesmo digisac_user_id envia p/ ≥5 contatos distintos em 60 s,
--      o bloco é ignorado (em set/26 o máximo real foi 4 → não pega nada).
--  (3) Cor do dia (BRT) pela 1ª mensagem válida: <12:00 verde +1; 12:00–16:59
--      amarelo 0; ≥17:00 vermelho −1; dia útil sem contato vermelho −1.
--  (4) Dia útil = seg–sex exceto is_national_holiday. Fim de semana/feriado não
--      pontuam nem viram falta (sem linha).
--  (5) Empresa avaliada = estava em grupo ATIVO (Ativos/Ema) NAQUELE dia —
--      reconstruído por company_events 'grupo_alterado' (estado no INÍCIO do dia);
--      sem evento, o grupo de origem (fromId do 1º evento) ou o atual.
--  (6) Pontos vão ao colaborador responsável (company_collaborators) do dia; sem
--      responsável, a empresa aparece mas não pontua. Set/out usam o atual.
--  (7) Grava por dia em followup_daily_scores. Dia atual "em andamento": sem
--      contato antes das 17:00 = 'aguardando' (cinza, 0), não vermelho.
--  (8) Cron recomputa hoje + ontem (:15 de cada hora) e consolida (00:30).
-- Leituras por RPC SECURITY DEFINER com gate (pontuação: is_admin; acompanhamento:
-- escopo). REVOKE public, anon em toda função nova.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabela de pontuação diária (uma linha por dia útil × empresa avaliada).
--    'aguardando' só no dia corrente antes das 17:00; nunca finalizado.
-- ---------------------------------------------------------------------
create table followup_daily_scores (
  d               date not null,
  company_id      uuid not null references companies(id) on delete cascade,
  collaborator_id uuid references profiles(id) on delete set null,
  first_msg_at    timestamptz,
  color           text not null check (color in ('verde', 'amarelo', 'vermelho', 'aguardando')),
  points          integer not null default 0,
  finalized       boolean not null default false,
  computed_at     timestamptz not null default now(),
  primary key (d, company_id),
  check (not finalized or color <> 'aguardando')
);
create index followup_scores_collab_idx on followup_daily_scores(collaborator_id, d);
create index followup_scores_day_color_idx on followup_daily_scores(d, color);

-- RLS ligada SEM policy permissiva: todo acesso é pelos RPCs DEFINER abaixo.
alter table followup_daily_scores enable row level security;

-- ---------------------------------------------------------------------
-- 2) Helpers de calendário e de grupo-por-dia.
-- ---------------------------------------------------------------------
create or replace function followup_is_business_day(p_day date)
returns boolean language sql stable set search_path = public as $$
  select extract(isodow from p_day) < 6 and not is_national_holiday(p_day);
$$;

-- Dia relevante do quadro: o dia útil mais recente <= hoje (hoje, se útil; senão o
-- último dia útil — ex.: no sábado, a sexta).
create or replace function followup_relevant_day()
returns date language sql stable set search_path = public as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select max(gs::date)
    from today, generate_series(today.d - 10, today.d, interval '1 day') gs
   where followup_is_business_day(gs::date) and gs::date <= (select d from today);
$$;

-- Último dia útil FECHADO (estritamente antes de hoje) — Capacidade/Parados (o
-- dia de hoje não conta).
create or replace function followup_last_closed_business_day()
returns date language sql stable set search_path = public as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select max(gs::date)
    from today, generate_series(today.d - 10, today.d - 1, interval '1 day') gs
   where followup_is_business_day(gs::date);
$$;

-- Grupo da empresa no INÍCIO do dia p_day (decisão 5): último 'grupo_alterado'
-- com created_at < 00:00 BRT de p_day → toId; se não houver evento anterior, o
-- grupo de ORIGEM do 1º evento (fromId — pode ser null, i.e. a empresa ainda não
-- existia/estava em On Boarding → não é ativa antes do 1º evento); se a empresa
-- NÃO tem nenhum evento, o grupo ATUAL.
create or replace function followup_group_on_day(p_company uuid, p_day date)
returns uuid language sql stable security definer set search_path = public as $$
  with cutoff as (select (p_day::timestamp at time zone 'America/Sao_Paulo') as ts),
  latest as (
    select (ce.details->>'toId')::uuid as gid
      from company_events ce, cutoff
     where ce.company_id = p_company and ce.event_type = 'grupo_alterado'
       and ce.created_at < cutoff.ts
     order by ce.created_at desc limit 1
  ),
  firstev as (
    select (ce.details->>'fromId')::uuid as gid, true as present
      from company_events ce
     where ce.company_id = p_company and ce.event_type = 'grupo_alterado'
     order by ce.created_at asc limit 1
  )
  select case
    when (select gid from latest) is not null then (select gid from latest)
    when (select present from firstev) then (select gid from firstev)
    else (select group_id from companies where id = p_company)
  end;
$$;

revoke execute on function followup_is_business_day(date)        from public, anon;
revoke execute on function followup_relevant_day()               from public, anon;
revoke execute on function followup_last_closed_business_day()   from public, anon;
revoke execute on function followup_group_on_day(uuid, date)     from public, anon;

-- ---------------------------------------------------------------------
-- 3) Recompute de um dia: calcula/UPSERT todas as empresas ativas naquele dia.
--    Fora de dia útil → sem linhas (apaga se houver). Futuro → no-op.
-- ---------------------------------------------------------------------
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
  -- Regra 2: descarta mensagens em bloco de massa (≥5 contatos distintos do mesmo
  -- usuário numa janela de 60 s ao redor da mensagem).
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

  -- Limpa empresas que (nesse dia) não estão mais ativas — idempotência do recompute.
  delete from followup_daily_scores fds
   where fds.d = p_day
     and not exists (
       select 1 from company_groups g
        where g.id = followup_group_on_day(fds.company_id, p_day) and g.kind = 'active'
     );

  return v_count;
end;
$$;

create or replace function followup_backfill(p_from date, p_to date)
returns integer language plpgsql security definer set search_path = public as $$
declare d date := p_from; v_total int := 0;
begin
  while d <= p_to loop
    v_total := v_total + followup_recompute_day(d);
    d := d + 1;
  end loop;
  return v_total;
end;
$$;

create or replace function followup_cron()
returns integer language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform followup_recompute_day(v_today - 1);  -- consolida/ajusta ontem
  perform followup_recompute_day(v_today);       -- dia corrente em andamento
  return 1;
end;
$$;

revoke execute on function followup_recompute_day(date) from public, anon, authenticated;
revoke execute on function followup_backfill(date, date) from public, anon, authenticated;
revoke execute on function followup_cron() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) Cron (decisão 8): recompute hoje+ontem a cada hora (min 15, após o
--    digisac-sync) e consolidação às 00:30.
-- ---------------------------------------------------------------------
select cron.unschedule('followup-scores-hourly')
 where exists (select 1 from cron.job where jobname = 'followup-scores-hourly');
select cron.unschedule('followup-scores-consolidate')
 where exists (select 1 from cron.job where jobname = 'followup-scores-consolidate');
select cron.schedule('followup-scores-hourly',      '15 * * * *', $$ select public.followup_cron(); $$);
select cron.schedule('followup-scores-consolidate', '30 0 * * *', $$ select public.followup_cron(); $$);

-- ---------------------------------------------------------------------
-- 5) Último sync do Digisac ("Atualizado às HH:MM").
-- ---------------------------------------------------------------------
create or replace function followup_last_sync()
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(finished_at) from digisac_sync_runs where status = 'ok';
$$;
revoke execute on function followup_last_sync() from public, anon;
grant  execute on function followup_last_sync() to authenticated;

-- ---------------------------------------------------------------------
-- 6) Quadro de Acompanhamento (decisão 11): cor do DIA RELEVANTE por empresa
--    ativa que o chamador alcança (admin: todas; consultor: a carteira dele).
--    + última mensagem, contagem de dias por cor no período e reunião futura.
-- ---------------------------------------------------------------------
create or replace function followup_board(p_period_days int default 30)
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

-- ---------------------------------------------------------------------
-- 7) Pontuação (decisão 10) — ADMIN. Resumo por colaborador do mês e a grade
--    dia×empresa de um colaborador (null = sem responsável).
-- ---------------------------------------------------------------------
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

create or replace function followup_scores_detail(p_collaborator uuid, p_month date)
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
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_detail(uuid, date) from public, anon;
grant  execute on function followup_scores_detail(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Capacidade — "Parados" (decisão 12/novo 5) = empresas VERMELHAS no último
--    dia útil FECHADO (hoje não conta). "Alerta" segue a etiqueta manual.
--    team_capacity: mesmo retorno → create or replace. Só muda o cálculo de
--    carteira_stalled (CTE red_last; sai a dependência de client_followup).
-- ---------------------------------------------------------------------
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
  v_red_day  date := followup_last_closed_business_day();
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
    select cc.consultant_id as person, cc.company_id,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  active_carteira as ( select person, company_id from carteira where is_active ),
  company_consultant_count as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  -- Parados: empresas vermelhas no último dia útil fechado (Digisac).
  red_last as (
    select company_id from followup_daily_scores
     where d = v_red_day and color = 'vermelho'
  ),
  by_group as (
    select person,
           jsonb_agg(jsonb_build_object('name', gname, 'count', n) order by gpos, gname) as list
      from ( select person, gname, gpos, count(*) as n from carteira group by person, gname, gpos ) q
     group by person
  ),
  cart as (
    select ac.person, count(*) as active,
           count(*) filter (where ccc.n = 1) as exclusive,
           count(*) filter (where ccc.n > 1) as shared,
           count(*) filter (where al.company_id is not null) as alerta,
           count(*) filter (where rl.company_id is not null) as stalled
      from active_carteira ac
      join company_consultant_count ccc on ccc.company_id = ac.company_id
      left join red_last rl on rl.company_id = ac.company_id
      left join lateral (
        select 1 as company_id from company_effective_labels cl
          join labels l on l.id = cl.label_id
         where cl.company_id = ac.company_id and lower(l.name) = 'alerta' limit 1
      ) al on true
     group by ac.person
  ),
  meet as (
    select mtp.user_id as person, sum(eff.secs)::bigint as secs
      from meeting_timer_people mtp
      join (
        select t.id as timer_id,
               coalesce(t.manual_seconds::bigint,
                 coalesce((select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                             from meeting_timer_segments s where s.timer_id = t.id), 0)) as secs,
               (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start
          from meeting_timers t
      ) eff on eff.timer_id = mtp.timer_id
     where (v_start_ts is null or eff.first_start >= v_start_ts)
       and (v_end_ts   is null or eff.first_start <  v_end_ts)
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
      from ( select person, gname, gpos, count(*) as n from colab_carteira group by person, gname, gpos ) q
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
      from time_entries te join task_instances t on t.id = te.task_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
    union
    select ti.collaborator_id, ti.company_id
      from task_instances ti join task_templates tt on tt.id = ti.template_id
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
    pe.id, dp.name, dp.avatar_path,
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
  left join lateral ( select d.name, d.avatar_path from display_profiles(array[pe.id]::uuid[]) d ) dp on true
  left join executors ex on ex.id = pe.id
  left join cart on cart.person = pe.id
  left join meet ms on ms.person = pe.id
  left join by_group bg on bg.person = pe.id
  left join colab_active ca on ca.person = pe.id
  left join colab_by_group cbg on cbg.person = pe.id
  left join colab_outside oop on oop.person = pe.id
  left join act_time at on at.person = pe.id
  left join act_done ad on ad.person = pe.id
  left join act_companies acp on acp.person = pe.id
  left join act_overdue ao on ao.person = pe.id;
end;
$$;
revoke execute on function team_capacity(date, date) from public, anon;
grant  execute on function team_capacity(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 9) Drill-down "Parados" da Capacidade → mesmas empresas vermelhas no último dia
--    útil fechado; days_since = dias desde a última mensagem válida (exibição).
--    Mesmo retorno → create or replace. Demais escopos inalterados.
-- ---------------------------------------------------------------------
create or replace function team_capacity_drilldown(
  p_person uuid, p_scope text, p_start date default null, p_end date default null
)
returns table (
  company_id uuid, company_name text, group_name text, labels jsonb, shared_with jsonb, days_since integer
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
    coalesce(lab.list, '[]'::jsonb), coalesce(sh.list, '[]'::jsonb), s.dsince
  from scoped s
  join companies c on c.id = s.company_id
  left join company_groups g on g.id = c.group_id
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
