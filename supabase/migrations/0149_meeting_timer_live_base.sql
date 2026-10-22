-- =====================================================================
-- 0149 — Fonte única do tempo exibido: base que NÃO tiquetaqueia + server_now
-- =====================================================================
-- Corrige a divergência do tempo entre o pop-up (certo), o card da Agenda e o
-- card da aba Reuniões. Os cards ficavam presos no total do carregamento porque
-- recalculavam a base fechada a cada tique a partir de Date.now(), anulando o
-- avanço. Agora o servidor entrega a BASE que não corre:
--   base_seconds = manual_seconds (se houver) OU soma dos trechos FECHADOS
-- mais o started_at do trecho ABERTO e um server_now (para a defasagem de relógio
-- do navegador). O cliente calcula, a cada tique: base + (agora+skew − started_at).
-- Uma só conta, usada pelo pop-up, pelos dois cards e pela linha da empresa.
--
-- Trocam de RETORNO → DROP + CREATE: readable_meeting_timers, my_open_meeting_timer,
-- company_meeting_hours. As demais leituras/Capacidade seguem com a foto do servidor
-- (não são relógios ao vivo). REVOKE public, anon em toda função recriada (dec. 12).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) readable_meeting_timers — base_seconds + server_now (cards da Agenda/aba).
--    base_seconds = manual (se houver) OU soma só dos trechos FECHADOS; o trecho
--    aberto conta no cliente a partir de open_started_at.
-- ---------------------------------------------------------------------
drop function if exists readable_meeting_timers();
create function readable_meeting_timers()
returns table(
  timer_id uuid, meeting_id uuid, google_event_id text, company_id uuid,
  title text, started_by uuid, is_open boolean, open_started_at timestamptz,
  finalized boolean, base_seconds bigint, server_now timestamptz
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.meeting_id, t.google_event_id, t.company_id, t.title, t.started_by,
         exists (select 1 from meeting_timer_segments s where s.timer_id = t.id and s.ended_at is null),
         (select s.started_at from meeting_timer_segments s
            where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1),
         (t.finalized_at is not null),
         coalesce(t.manual_seconds::bigint,
           coalesce((select sum(extract(epoch from (s.ended_at - s.started_at)))::bigint
                       from meeting_timer_segments s
                      where s.timer_id = t.id and s.ended_at is not null), 0)),
         now()
    from meeting_timers t;
$$;
revoke execute on function readable_meeting_timers() from public, anon;
grant  execute on function readable_meeting_timers() to authenticated;

-- ---------------------------------------------------------------------
-- 2) my_open_meeting_timer — base_seconds (trechos fechados) + server_now.
--    Só devolve timer ABERTO; base_seconds é a soma dos trechos JÁ fechados (o
--    aberto conta no cliente a partir de started_at). Timer aberto nunca tem
--    manual_seconds (não se edita rodando).
-- ---------------------------------------------------------------------
drop function if exists my_open_meeting_timer();
create function my_open_meeting_timer()
returns table(timer_id uuid, title text, company_id uuid, started_at timestamptz,
              base_seconds bigint, server_now timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.company_id, s.started_at,
         coalesce((select sum(extract(epoch from (x.ended_at - x.started_at)))::bigint
                     from meeting_timer_segments x
                    where x.timer_id = t.id and x.ended_at is not null), 0),
         now()
    from meeting_timers t
    join meeting_timer_segments s on s.timer_id = t.id and s.ended_at is null
   where t.started_by = auth.uid()
   order by s.started_at desc limit 1;
$$;
revoke execute on function my_open_meeting_timer() from public, anon;
grant  execute on function my_open_meeting_timer() to authenticated;

-- ---------------------------------------------------------------------
-- 3) company_meeting_hours — por consultor: base_seconds (soma do que NÃO corre,
--    i.e. manual OU trechos fechados, nos timers do período) + open_starts (lista
--    dos started_at dos trechos abertos) + server_now. O cliente soma o ao vivo.
-- ---------------------------------------------------------------------
drop function if exists company_meeting_hours(uuid, date, date);
create function company_meeting_hours(
  p_company uuid, p_start date default null, p_end date default null
) returns table(
  user_id uuid, user_name text, avatar_path text,
  base_seconds bigint, open_starts jsonb, server_now timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select is_admin()) or p_company in (select my_consultant_companies())) then
    raise exception 'company_meeting_hours: acesso restrito.' using errcode = '42501';
  end if;
  return query
  with eff as (
    select t.id as timer_id, t.company_id,
           coalesce(t.manual_seconds::bigint,
             coalesce((select sum(extract(epoch from (s.ended_at - s.started_at)))::bigint
                         from meeting_timer_segments s
                        where s.timer_id = t.id and s.ended_at is not null), 0)) as base_secs,
           (select s.started_at from meeting_timer_segments s
              where s.timer_id = t.id and s.ended_at is null order by s.started_at desc limit 1) as open_start,
           (select min(s.started_at) from meeting_timer_segments s where s.timer_id = t.id) as first_start
      from meeting_timers t
  ),
  scoped as (
    select timer_id, base_secs, open_start from eff
     where company_id = p_company
       and (p_start is null or first_start >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
       and (p_end   is null or first_start <  (p_end::timestamp   at time zone 'America/Sao_Paulo'))
  )
  select mtp.user_id, pr.full_name, pr.avatar_path,
         sum(sc.base_secs)::bigint,
         coalesce(jsonb_agg(sc.open_start) filter (where sc.open_start is not null), '[]'::jsonb),
         now()
    from scoped sc
    join meeting_timer_people mtp on mtp.timer_id = sc.timer_id
    join profiles pr on pr.id = mtp.user_id
   group by mtp.user_id, pr.full_name, pr.avatar_path
   order by pr.full_name;
end;
$$;
revoke execute on function company_meeting_hours(uuid, date, date) from public, anon;
grant  execute on function company_meeting_hours(uuid, date, date) to authenticated;
