-- =====================================================================
-- 0161 — RPC leve: horas em reunião por consultor, no período
-- =====================================================================
-- A seção "Consultores" da Capacidade ganhou um PeriodPicker PRÓPRIO (params
-- cde/cate), independente do filtro de Colaboradores (tarefas). A coluna
-- "Horas em reunião" passa a seguir ESSE filtro.
--
-- Para não chamar `team_capacity` duas vezes (ela agrega a pessoa inteira), esta
-- RPC devolve SÓ consultant_id + meeting_seconds, usando EXATAMENTE a mesma regra
-- de soma de reunião do team_capacity (CTE `meet`/`eff` — 0156):
--   · duração do timer = manual_seconds, senão soma dos segmentos
--     (coalesce(ended_at, now()) - started_at), senão 0;
--   · a pessoa é meeting_timer_people.user_id (conduziu OU participante interno);
--   · filtro por first_start = min(started_at) dos segmentos;
--   · início INCLUSIVO, fim EXCLUSIVO (first_start >= p_start@BRT e < p_end@BRT) —
--     o front converte o `end` inclusivo do PeriodPicker somando 1 dia, igual ao
--     que a página já faz para as tarefas.
--
-- SECURITY DEFINER com gate is_admin(); REVOKE de public/anon (convenção).
-- Aditiva: nada é alterado nas tabelas nem no team_capacity.
--
-- ROLLBACK (completo, pois é puramente aditiva):
--   drop function if exists public.capacity_consultant_meetings(date, date);
-- =====================================================================

create or replace function public.capacity_consultant_meetings(
  p_start date default null,
  p_end   date default null
)
returns table(consultant_id uuid, meeting_seconds bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not (select is_admin()) then
    raise exception 'capacity_consultant_meetings: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  with eff as (
    select t.id as timer_id,
           coalesce(
             t.manual_seconds::bigint,
             coalesce(
               (select sum(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)))::bigint
                  from meeting_timer_segments s
                 where s.timer_id = t.id),
               0
             )
           ) as secs,
           (select min(s.started_at)
              from meeting_timer_segments s
             where s.timer_id = t.id) as first_start
      from meeting_timers t
  )
  select mtp.user_id as consultant_id,
         sum(eff.secs)::bigint as meeting_seconds
    from meeting_timer_people mtp
    join eff on eff.timer_id = mtp.timer_id
   where (v_start_ts is null or eff.first_start >= v_start_ts)
     and (v_end_ts   is null or eff.first_start <  v_end_ts)
   group by mtp.user_id;
end;
$$;

revoke execute on function public.capacity_consultant_meetings(date, date) from public, anon;
grant  execute on function public.capacity_consultant_meetings(date, date) to authenticated;
