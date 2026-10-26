-- =====================================================================
-- 0158 — Acompanhamento: história do cliente (eventos, selos, histórico, filtro)
-- =====================================================================
-- Sobre a recuperação (0157). Mostra a HISTÓRIA de cada cliente: quando ficou
-- vermelho, se recupera, se recaiu. Fonte ÚNICA: followup_daily_scores — o evento
-- do dia é DERIVADO comparando com a linha anterior da empresa (lag por d).
--
--  (1) followup_day_event(prev_color, prev_need, color, contact_color): rótulo do
--      dia (Ficou vermelho / Continua vermelho / Recaiu / 1º verde da recuperação /
--      Contato à tarde, não avançou / Recuperado / Aguardando contato / null).
--  (2) followup_company_history(company, month): timeline do mês + resumo (RPC
--      DEFINER, mesmo gate do board).
--  (3) followup_board ganha o SELO do dia relevante: red_streak (dias úteis
--      vermelhos consecutivos) + red_since + relapse_at (recaída nos últimos 5
--      dias úteis). Return muda ⇒ DROP + CREATE.
--  (4) followup_scores_month/_export ganham p_recovering (filtro "Em recuperação":
--      empresa com recovery_need > 0 no dia relevante do mês). Assinatura muda ⇒
--      DROP + CREATE.
--  (6) followup_scores_detail ganha `evento` (p/ contar ficaram vermelhos /
--      recuperados / recaídas por colaborador). Return muda ⇒ DROP + CREATE.
--  (7) Limpeza no recompute: apaga linhas NÃO finalizadas de empresas não
--      avaliadas (sem colaborador OU fora de Ativos/Ema). Finalizadas ficam.
--
-- Decisão 8: DROP+CREATE quando muda o retorno; REVOKE public,anon; gates atuais.
-- Rollback completo em supabase/rollback/0158_*.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Rótulo do evento do dia (decisão 1). Puro: compara a linha com a anterior.
--    Imutável — não lê dados. Usado por history, board e scores_detail.
-- ---------------------------------------------------------------------
create or replace function followup_day_event(
  p_prev_color text, p_prev_need int, p_color text, p_contact text
) returns text immutable language sql set search_path = public as $$
  select case
    when p_color = 'vermelho' then
      case when p_prev_color = 'vermelho' then 'Continua vermelho'
           when coalesce(p_prev_need, 0) > 0 then 'Recaiu'
           else 'Ficou vermelho' end
    when p_color = 'aguardando' then 'Aguardando contato'
    when coalesce(p_prev_need, 0) = 2 and p_contact = 'verde'   then '1º verde da recuperação'
    when coalesce(p_prev_need, 0) = 1 and p_contact = 'verde'   then 'Recuperado'
    when coalesce(p_prev_need, 0) > 0 and p_contact = 'amarelo' then 'Contato à tarde, não avançou'
    else null
  end;
$$;
revoke execute on function followup_day_event(text, int, text, text) from public, anon;
grant  execute on function followup_day_event(text, int, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Recompute — mesma lógica da 0157; só muda a LIMPEZA (decisão 7): apaga
--    linhas NÃO finalizadas de empresas não avaliadas no dia (fora de Ativos/Ema
--    OU sem colaborador agora). Finalizadas nunca são apagadas.
-- ---------------------------------------------------------------------
create or replace function followup_recompute_day(p_day date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today      date      := (now() at time zone 'America/Sao_Paulo')::date;
  v_now_time   time      := (now() at time zone 'America/Sao_Paulo')::time;
  v_finalized  boolean   := p_day < v_today;
  v_is_current boolean   := p_day = v_today;
  v_vigencia   date      := date '2026-10-26';
  v_count      int       := 0;
begin
  if not followup_is_business_day(p_day) then
    delete from followup_daily_scores where d = p_day and not finalized;
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
           fm.first_at,
           case
             when fm.first_at is not null and (fm.first_at at time zone 'America/Sao_Paulo')::time < time '12:00:00' then 'verde'
             when fm.first_at is not null and (fm.first_at at time zone 'America/Sao_Paulo')::time < time '17:00:00' then 'amarelo'
             when fm.first_at is not null then 'vermelho'
             when v_is_current and v_now_time < time '17:00:00' and ac.whatsapp_contact_id is not null then 'aguardando'
             else 'vermelho'
           end as cc,
           coalesce((select fds2.recovery_need from followup_daily_scores fds2
                       where fds2.company_id = ac.company_id and fds2.d < p_day
                       order by fds2.d desc limit 1), 0) as prev_need
      from active_co ac
      left join first_msg fm on fm.company_id = ac.company_id
  ),
  final as (
    select s.company_id, s.first_at, s.cc,
           case
             when p_day < v_vigencia then s.cc
             when s.cc = 'vermelho'   then 'vermelho'
             when s.cc = 'aguardando' then 'aguardando'
             when s.cc = 'verde' and s.prev_need = 2 then 'amarelo'
             when s.cc = 'verde'      then 'verde'
             else 'amarelo'
           end as client_color,
           case
             when p_day < v_vigencia then (case when s.cc = 'vermelho' then 2 else 0 end)
             when s.cc = 'aguardando' then s.prev_need
             when s.cc = 'vermelho'   then 2
             when s.cc = 'verde' and s.prev_need = 2 then 1
             when s.cc = 'verde'      then 0
             else s.prev_need
           end as new_need
      from scored s
  ),
  upserted as (
    insert into followup_daily_scores
      (d, company_id, collaborator_id, first_msg_at, contact_color, color, points, recovery_need, finalized, computed_at)
    select p_day, f.company_id,
           (select cc.collaborator_id from company_collaborators cc
             where cc.company_id = f.company_id order by cc.collaborator_id limit 1),
           f.first_at, f.cc, f.client_color,
           case when f.client_color = 'verde' then 1
                when f.client_color = 'vermelho' then -1
                else 0 end,
           f.new_need, v_finalized, now()
      from final f
    on conflict (d, company_id) do update
       set collaborator_id = excluded.collaborator_id,
           first_msg_at    = excluded.first_msg_at,
           contact_color   = excluded.contact_color,
           color           = excluded.color,
           points          = excluded.points,
           recovery_need   = excluded.recovery_need,
           finalized       = excluded.finalized,
           computed_at     = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;

  -- Limpeza (decisão 7): some com linhas NÃO finalizadas de quem não é mais
  -- avaliado no dia (fora de grupo ativo OU sem colaborador). Finalizadas ficam.
  delete from followup_daily_scores fds
   where fds.d = p_day
     and not fds.finalized
     and (
       not exists (select 1 from company_groups g
                    where g.id = followup_group_on_day(fds.company_id, p_day) and g.kind = 'active')
       or not exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
     );

  return v_count;
end;
$$;
revoke execute on function followup_recompute_day(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Histórico do contato de UMA empresa num mês (decisão 2). jsonb com `days`
--    (timeline do mês, mais recente em cima; só dias úteis com linha) + `summary`
--    (dias vermelhos, recaídas, recuperações, situação atual). Gate = do board.
-- ---------------------------------------------------------------------
create or replace function followup_company_history(p_company uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today       date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month_start date := date_trunc('month', p_month)::date;
  v_month_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_is_current  boolean := date_trunc('month', p_month) = date_trunc('month', v_today);
  v_relevant    date;
  v_days jsonb; v_reds int; v_relapses int; v_recoveries int;
  v_rel_color text; v_rel_need int; v_streak int; v_since date; v_situacao text;
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'followup_company_history: acesso restrito.' using errcode = '42501';
  end if;

  if v_is_current then
    v_relevant := followup_relevant_day();
  else
    select max(gs::date) into v_relevant
      from generate_series(v_month_start, (v_month_end - 1), interval '1 day') gs
     where followup_is_business_day(gs::date);
  end if;

  -- Timeline do mês + contagens (eventos via lag sobre TODA a história da empresa,
  -- para o 1º dia do mês enxergar a linha anterior).
  with hist as (
    select fds.d, fds.first_msg_at, fds.contact_color, fds.color, fds.points, fds.recovery_need,
           lag(fds.color)         over w as prev_color,
           lag(fds.recovery_need) over w as prev_need
      from followup_daily_scores fds
     where fds.company_id = p_company and fds.d < v_month_end
    window w as (order by fds.d)
  ),
  ev as (
    select *, followup_day_event(prev_color, prev_need, color, contact_color) as evento from hist
  ),
  m as (select * from ev where d >= v_month_start)
  select
    coalesce(jsonb_agg(jsonb_build_object(
       'd', d, 'first_msg_at', first_msg_at, 'contact_color', contact_color,
       'color', color, 'points', points, 'recovery_need', recovery_need,
       'evento', case when evento = 'Aguardando contato' and recovery_need > 0
                      then 'Aguardando contato · precisa de contato antes das 12h'
                      else evento end
     ) order by d desc), '[]'::jsonb),
    count(*) filter (where color = 'vermelho')::int,
    count(*) filter (where evento = 'Recaiu')::int,
    count(*) filter (where evento = 'Recuperado')::int
  into v_days, v_reds, v_relapses, v_recoveries
  from m;

  -- Situação atual = estado da última linha <= dia relevante.
  select color, recovery_need into v_rel_color, v_rel_need
    from followup_daily_scores
   where company_id = p_company and d <= v_relevant
   order by d desc limit 1;

  if v_rel_color = 'vermelho' then
    select count(*)::int, min(d) into v_streak, v_since
      from followup_daily_scores
     where company_id = p_company and d <= v_relevant and color = 'vermelho'
       and d > coalesce((select max(d) from followup_daily_scores
                          where company_id = p_company and d <= v_relevant and color <> 'vermelho'),
                        date '0001-01-01');
    v_situacao := 'Vermelho há ' || v_streak || ' dia' ||
                  case when v_streak > 1 then 's úteis' else ' útil' end ||
                  ' (desde ' || to_char(v_since, 'DD/MM') || ')';
  elsif coalesce(v_rel_need, 0) > 0 then
    v_situacao := 'Recuperando · falta ' || v_rel_need || ' verde' ||
                  case when v_rel_need > 1 then 's' else '' end;
  elsif v_rel_color is null then
    v_situacao := 'Sem registro no período';
  else
    v_situacao := 'Em dia';
  end if;

  return jsonb_build_object(
    'relevant_day', v_relevant,
    'days', v_days,
    'summary', jsonb_build_object(
      'reds', v_reds, 'relapses', v_relapses, 'recoveries', v_recoveries, 'situacao', v_situacao
    )
  );
end;
$$;
revoke execute on function followup_company_history(uuid, date) from public, anon;
grant  execute on function followup_company_history(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Quadro — + selo do dia relevante (decisão 3): red_streak/red_since (dias
--    úteis vermelhos consecutivos até o dia relevante) e relapse_at (recaída nos
--    últimos 5 dias úteis). Base: 0157. Return muda ⇒ DROP + CREATE.
-- ---------------------------------------------------------------------
drop function if exists followup_board(date);
create function followup_board(p_month date)
returns table(
  company_id uuid, company_name text, consultants jsonb, collaborators jsonb,
  relevant_day date, color text, contact_color text, recovery_need int,
  red_streak int, red_since date, relapse_at date, is_today boolean,
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
  v_relapse_from date;
begin
  if v_is_current then
    v_relevant := followup_relevant_day();
  else
    select max(gs::date) into v_relevant
      from generate_series(v_month_start, (v_month_end - 1), interval '1 day') gs
     where followup_is_business_day(gs::date);
  end if;

  -- Primeiro dos últimos 5 dias úteis <= dia relevante (janela da recaída).
  select min(q.x) into v_relapse_from from (
    select gs::date x from generate_series(v_relevant - 20, v_relevant, interval '1 day') gs
     where followup_is_business_day(gs::date)
     order by gs desc limit 5
  ) q;

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
           fds.company_id, fds.color, fds.contact_color, fds.recovery_need,
           fds.first_msg_at, fds.collaborator_id
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d >= v_month_start and fds.d <= v_relevant
     order by fds.company_id, fds.d desc
  ),
  -- História (até o dia relevante) p/ o selo: streak vermelho + recaída recente.
  hist as (
    select fds.company_id, fds.d, fds.color, fds.contact_color, fds.recovery_need,
           lag(fds.color)         over w as prev_color,
           lag(fds.recovery_need) over w as prev_need
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d <= v_relevant
    window w as (partition by fds.company_id order by fds.d)
  ),
  last_nonred as (
    select hist.company_id, max(hist.d) as d from hist where hist.color <> 'vermelho' group by hist.company_id
  ),
  red_streak as (
    select h.company_id, count(*)::int as n, min(h.d) as since
      from hist h
      left join last_nonred ln on ln.company_id = h.company_id
     where h.color = 'vermelho' and h.d > coalesce(ln.d, date '0001-01-01')
     group by h.company_id
  ),
  relapse as (
    select hist.company_id, max(hist.d) as at from hist
     where hist.d >= v_relapse_from
       and followup_day_event(hist.prev_color, hist.prev_need, hist.color, hist.contact_color) = 'Recaiu'
     group by hist.company_id
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
         coalesce(rel.contact_color, coalesce(rel.color, 'vermelho')),
         coalesce(rel.recovery_need, 0),
         coalesce(red_streak.n, 0), red_streak.since, relapse.at,
         (v_is_current and v_relevant = v_today and followup_is_business_day(v_today)),
         rel.first_msg_at, lastmsg.at,
         case when v_is_current then nextmeet.at else null end,
         coalesce(tally.v, 0)::int, coalesce(tally.a, 0)::int, coalesce(tally.r, 0)::int,
         rel.collaborator_id, resp.rname
    from scoped s
    left join rel        on rel.company_id = s.id
    left join red_streak on red_streak.company_id = s.id
    left join relapse    on relapse.company_id = s.id
    left join tally      on tally.company_id = s.id
    left join lastmsg    on lastmsg.company_id = s.id
    left join nextmeet   on nextmeet.company_id = s.id
    left join cons       on cons.company_id = s.id
    left join colabs     on colabs.company_id = s.id
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
-- 5) Detalhe da Pontuação — + `evento` do dia (decisão 6). Evento via lag sobre
--    TODA a história da empresa; depois filtra as linhas do colaborador no mês.
--    Return muda ⇒ DROP + CREATE. Base: 0157.
-- ---------------------------------------------------------------------
drop function if exists followup_scores_detail(uuid, date);
create function followup_scores_detail(p_collaborator uuid, p_month date)
returns table(
  company_id uuid, company_name text, d date,
  contact_color text, color text, recovery_need int, evento text,
  first_msg_at timestamptz, points int
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date;
        v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then
    raise exception 'followup_scores_detail: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with scope_co as (
    select distinct fds.company_id
      from followup_daily_scores fds
     where fds.d >= v_from and fds.d < v_to
       and fds.collaborator_id is not distinct from p_collaborator
       and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
  ),
  ev as (
    select fds.company_id, fds.d, fds.collaborator_id, fds.contact_color, fds.color,
           fds.recovery_need, fds.first_msg_at, fds.points,
           followup_day_event(
             lag(fds.color)         over w,
             lag(fds.recovery_need) over w,
             fds.color, fds.contact_color) as evento
      from followup_daily_scores fds
     where fds.company_id in (select scope_co.company_id from scope_co)
    window w as (partition by fds.company_id order by fds.d)
  )
  select ev.company_id, c.name, ev.d, ev.contact_color, ev.color, ev.recovery_need,
         ev.evento, ev.first_msg_at, ev.points
    from ev join companies c on c.id = ev.company_id
   where ev.d >= v_from and ev.d < v_to
     and ev.collaborator_id is not distinct from p_collaborator
   order by c.name, ev.d;
end;
$$;
revoke execute on function followup_scores_detail(uuid, date) from public, anon;
grant  execute on function followup_scores_detail(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Pontuação por colaborador + export — + filtro OPCIONAL "Em recuperação"
--    (decisão 4): empresa com recovery_need > 0 no DIA RELEVANTE do mês.
--    Base: 0156 (month) / 0157 (export). Assinatura muda ⇒ DROP + CREATE.
-- ---------------------------------------------------------------------
drop function if exists followup_scores_month(date, uuid, uuid);
create function followup_scores_month(
  p_month date, p_consultant uuid default null, p_collaborator uuid default null,
  p_recovering boolean default false
)
returns table(
  collaborator_id uuid, collaborator_name text, avatar_path text,
  points int, days_verde int, days_amarelo int, days_vermelho int, companies int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_current boolean := date_trunc('month', p_month) = date_trunc('month', v_today);
  v_relevant date;
begin
  if not is_admin() then
    raise exception 'followup_scores_month: acesso restrito a administradores.' using errcode = '42501';
  end if;
  if v_is_current then v_relevant := followup_relevant_day();
  else select max(gs::date) into v_relevant from generate_series(v_from, (v_to - 1), interval '1 day') gs
        where followup_is_business_day(gs::date); end if;

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
     and (not p_recovering or exists (
            select 1 from followup_daily_scores r
             where r.company_id = fds.company_id and r.d = v_relevant and r.recovery_need > 0))
   group by fds.collaborator_id, dp.dp_name, dp.dp_avatar
   order by sum(fds.points) desc nulls last;
end;
$$;
revoke execute on function followup_scores_month(date, uuid, uuid, boolean) from public, anon;
grant  execute on function followup_scores_month(date, uuid, uuid, boolean) to authenticated;

drop function if exists followup_scores_export(date, uuid, uuid);
create function followup_scores_export(
  p_month date, p_consultant uuid default null, p_collaborator uuid default null,
  p_recovering boolean default false
)
returns table(
  d date, company_id uuid, company_name text, group_name text,
  responsible_id uuid, responsible_name text,
  first_msg_at timestamptz, contact_color text, color text, recovery_need int, points int, finalized boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_current boolean := date_trunc('month', p_month) = date_trunc('month', v_today);
  v_relevant date;
begin
  if not is_admin() then
    raise exception 'followup_scores_export: acesso restrito a administradores.' using errcode = '42501';
  end if;
  if v_is_current then v_relevant := followup_relevant_day();
  else select max(gs::date) into v_relevant from generate_series(v_from, (v_to - 1), interval '1 day') gs
        where followup_is_business_day(gs::date); end if;

  return query
  select fds.d, fds.company_id, c.name,
         coalesce(g.name, '(sem grupo)'),
         fds.collaborator_id, rp.name,
         fds.first_msg_at, coalesce(fds.contact_color, fds.color), fds.color, fds.recovery_need,
         fds.points, fds.finalized
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
     and (not p_recovering or exists (
            select 1 from followup_daily_scores r
             where r.company_id = fds.company_id and r.d = v_relevant and r.recovery_need > 0))
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_export(date, uuid, uuid, boolean) from public, anon;
grant  execute on function followup_scores_export(date, uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Limpa o resíduo imediatamente (decisão 7): recompute de hoje com a nova
--    limpeza (tira a linha não finalizada da Dental Sol em 26/10).
-- ---------------------------------------------------------------------
select followup_recompute_day((now() at time zone 'America/Sao_Paulo')::date);
