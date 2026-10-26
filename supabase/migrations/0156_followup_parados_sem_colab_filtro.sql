-- =====================================================================
-- 0156 — Acompanhamento/Capacidade: Parados refinado, empresa sem colaborador
--        filtrada, e filtro de colaborador no export
-- =====================================================================
-- Ajustes sobre as migrations 0150–0154. Não reabre decisões já travadas.
--
--  (1) "Parados" (Capacidade) = empresa VERMELHA no último dia útil FECHADO
--      E SEM mensagem válida nossa HOJE (desde 00:00 BRT; is_from_me ∧ ¬bot ∧
--      ¬comment). Quem recebeu mensagem hoje sai de Parados na hora. Vale igual
--      na contagem (team_capacity.carteira_stalled) e no drill-down
--      (team_capacity_drilldown scope 'parados') — número e lista batem.
--      O índice digisac_messages(contact_id, sent_at) já existe (nada a criar).
--
--  (2) Empresa SEM colaborador responsável (nenhum company_collaborators) não é
--      considerada no Acompanhamento:
--        • followup_recompute_day não gera mais linha para ela (active_co exige
--          colaborador). NÃO apaga linhas existentes.
--        • Leituras filtram por "tem colaborador AGORA" (inclusive meses
--          anteriores): followup_board, followup_scores_month/_detail/_export e
--          Parados da Capacidade. A linha "Sem responsável" some.
--        • Ganhou colaborador → volta a pontuar do próximo cálculo (sem recalcular
--          dias anteriores — o recompute só roda hoje/ontem).
--
--  (4) followup_scores_month e followup_scores_export ganham filtros OPCIONAIS por
--      consultor e colaborador (default null) para o Excel respeitar o filtro do
--      quadro. Assinatura muda ⇒ DROP + CREATE.
--
-- Decisão 5: DROP+CREATE só quando muda o retorno/assinatura; REVOKE public,anon;
-- gates mantidos; RLS/gate com (select ...). Rollback completo em
-- supabase/rollback/0156_*.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (2a) Recompute do dia — só empresas ATIVAS no dia QUE TÊM colaborador agora.
--      Base: 0151. Única mudança: active_co exige company_collaborators.
--      O delete de idempotência segue só por grupo-no-dia (não apaga por falta de
--      colaborador — decisão "não apagar linhas existentes").
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

-- ---------------------------------------------------------------------
-- (2b) Quadro — filtra empresas sem colaborador agora (inclusive meses passados).
--      Base: 0153 (com collaborators jsonb). Única mudança: +exists colaborador
--      no `scoped`. Retorno idêntico ⇒ create or replace.
-- ---------------------------------------------------------------------
create or replace function followup_board(p_month date)
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

-- ---------------------------------------------------------------------
-- (2c + 4) Pontuação por colaborador — filtra empresas sem colaborador agora e
--      ganha filtros OPCIONAIS por consultor/colaborador. Assinatura muda ⇒ DROP.
-- ---------------------------------------------------------------------
drop function if exists followup_scores_month(date);
create function followup_scores_month(
  p_month date, p_consultant uuid default null, p_collaborator uuid default null
)
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
  select fds.collaborator_id, dp.dp_name, dp.dp_avatar,
         sum(fds.points)::int,
         count(*) filter (where fds.color = 'verde')::int,
         count(*) filter (where fds.color = 'amarelo')::int,
         count(*) filter (where fds.color = 'vermelho')::int,
         count(distinct fds.company_id)::int
    from followup_daily_scores fds
    left join lateral (
      select d.name as dp_name, d.avatar_path as dp_avatar
        from display_profiles(array[fds.collaborator_id]::uuid[]) d
    ) dp on fds.collaborator_id is not null
   where fds.d >= v_from and fds.d < v_to
     and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
     and (p_consultant is null or exists (
            select 1 from company_consultants cx
             where cx.company_id = fds.company_id and cx.consultant_id = p_consultant))
     and (p_collaborator is null or exists (
            select 1 from company_collaborators ck
             where ck.company_id = fds.company_id and ck.collaborator_id = p_collaborator))
   group by fds.collaborator_id, dp.dp_name, dp.dp_avatar
   order by sum(fds.points) desc nulls last;
end;
$$;
revoke execute on function followup_scores_month(date, uuid, uuid) from public, anon;
grant  execute on function followup_scores_month(date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- (2d) Drill-down da Pontuação (grade dia×empresa) — filtra sem-colaborador.
--      Mesma assinatura ⇒ create or replace. Base: 0150.
-- ---------------------------------------------------------------------
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
     and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_detail(uuid, date) from public, anon;
grant  execute on function followup_scores_detail(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- (2e + 4) Export da Pontuação — filtra sem-colaborador + filtros OPCIONAIS por
--      consultor/colaborador. Assinatura muda ⇒ DROP + CREATE. Base: 0152.
-- ---------------------------------------------------------------------
drop function if exists followup_scores_export(date);
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

-- ---------------------------------------------------------------------
-- (1a) team_capacity — "Parados" = vermelha no último dia útil fechado E sem
--      mensagem válida nossa hoje E com colaborador agora. Retorno idêntico ⇒
--      create or replace. Base: 0150. Mudança só no CTE red_last (+ v_today_ts).
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
  v_today_ts timestamptz := ((now() at time zone 'America/Sao_Paulo')::date::timestamp
                             at time zone 'America/Sao_Paulo');
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
  -- Parados: vermelhas no último dia útil fechado, SEM mensagem válida nossa hoje
  -- (desde 00:00 BRT) e COM colaborador responsável agora.
  red_last as (
    select fds.company_id
      from followup_daily_scores fds
      join companies c on c.id = fds.company_id
     where fds.d = v_red_day and fds.color = 'vermelho'
       and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
       and not exists (
         select 1 from digisac_messages dm
          where dm.contact_id = c.whatsapp_contact_id
            and dm.is_from_me and not dm.is_from_bot and not dm.is_comment
            and dm.sent_at >= v_today_ts
       )
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
-- (1b) Drill-down "Parados" — mesma definição (vermelha fechada + sem msg hoje +
--      com colaborador). Base: 0153 (com project_model). Retorno idêntico ⇒
--      create or replace. Mudança só no CTE red_last (+ v_today_ts).
-- ---------------------------------------------------------------------
create or replace function team_capacity_drilldown(
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
  v_today_ts timestamptz := (v_today::timestamp at time zone 'America/Sao_Paulo');
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
    select fds.company_id
      from followup_daily_scores fds
      join companies c on c.id = fds.company_id
     where fds.d = v_red_day and fds.color = 'vermelho'
       and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
       and not exists (
         select 1 from digisac_messages dm
          where dm.contact_id = c.whatsapp_contact_id
            and dm.is_from_me and not dm.is_from_bot and not dm.is_comment
            and dm.sent_at >= v_today_ts
       )
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
