-- =====================================================================
-- 0142_pause_periods_backfill :: CRM/Timer - Monvatti
-- =====================================================================
-- Carga do histórico de pausas (PASSO 3), reconstruída de company_events
-- 'grupo_alterado' (desde 10/09), para o grupo "Pausados". Conferida antes de
-- gravar. created_by/updated_by ficam nulos (carga automática, sem ator).
--
-- 1) 'historico': cada ENTRADA em Pausados abre um período; a primeira SAÍDA
--    posterior o fecha (aberto se ainda em Pausados).
-- 2) 'historico' órfão: SAÍDA sem entrada no histórico (empresa estava em
--    Pausados antes de 10/09) → período fechado com started_on NULO.
-- 3) 'pendente': empresa HOJE em Pausados sem evento de entrada → período aberto
--    com started_on NULO (admin preenche depois).
--
-- Rollback: supabase/rollback/0142_pause_periods_backfill.sql
-- =====================================================================
with P as (select 'f0ed1cdc-12ae-4c6c-8d35-26eb950b0705'::uuid as id),
evts as (
  select e.company_id, e.created_at,
         (e.created_at at time zone 'America/Sao_Paulo')::date as d,
         (e.details->>'toId')::uuid   is not distinct from (select id from P) as is_enter,
         (e.details->>'fromId')::uuid is not distinct from (select id from P) as is_exit
  from company_events e
  where e.event_type = 'grupo_alterado'
    and ((e.details->>'toId')::uuid = (select id from P)
      or (e.details->>'fromId')::uuid = (select id from P))
)
insert into company_pause_periods (company_id, started_on, ended_on, source)
-- (1) entradas → período até a primeira saída posterior (ou aberto)
select en.company_id, en.d,
  (select min(x.d) from evts x
    where x.company_id = en.company_id and x.is_exit and x.created_at > en.created_at),
  'historico'
from evts en
where en.is_enter
union all
-- (2) saídas órfãs (sem entrada antes) → fechado, início nulo
select x.company_id, null, x.d, 'historico'
from evts x
where x.is_exit
  and not exists (
    select 1 from evts en
    where en.company_id = x.company_id and en.is_enter and en.created_at < x.created_at
  )
union all
-- (3) pendentes: em Pausados hoje sem evento de entrada → aberto, início nulo
select c.id, null, null, 'pendente'
from companies c
where c.group_id = (select id from P)
  and not exists (
    select 1 from company_events e
    where e.company_id = c.id and e.event_type = 'grupo_alterado'
      and (e.details->>'toId')::uuid = (select id from P)
  );
