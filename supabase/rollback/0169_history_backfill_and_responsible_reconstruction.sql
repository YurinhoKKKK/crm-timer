-- =====================================================================
-- ROLLBACK 0169_history_backfill_and_responsible_reconstruction
-- =====================================================================
-- Apaga o que a 0169 inseriu: os eventos de backfill (por `source`) e os
-- períodos reconstruídos. Não toca em eventos go-forward (source null) nem em
-- períodos 'registrado'. Executar como dono (postgres).
-- =====================================================================

delete from public.company_events
 where source in (
   'time_adjustments', 'cs_audit', 'traffic_audit', 'dev_audit',
   'meeting_timer_audit', 'company_revenue_audit', 'company_pause_periods'
 );

delete from public.company_responsible_periods
 where source = 'reconstruido';

-- Restaura o NOT NULL de start_date (a 0169 o removeu p/ permitir consultor sem
-- início). Só funciona se não restarem linhas com start_date null (os reconstruídos
-- já foram apagados acima; os 'registrado' sempre têm start_date).
alter table public.company_responsible_periods alter column start_date set not null;
