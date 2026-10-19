-- =====================================================================
-- Reversão de 0142_pause_periods_backfill
-- =====================================================================
-- Remove os períodos carregados do histórico (historico/pendente). Períodos
-- 'auto' (criados pelo trigger) e 'manual' (criados por admin) ficam.
-- =====================================================================
delete from public.company_pause_periods where source in ('historico', 'pendente');

delete from supabase_migrations.schema_migrations
 where name = '0142_pause_periods_backfill';
