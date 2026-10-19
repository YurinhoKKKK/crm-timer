-- =====================================================================
-- Reversão de 0138_cs_set_company_label
-- =====================================================================
-- Remove a RPC. NÃO desfaz etiquetas já aplicadas nem linhas de cs_audit já
-- gravadas (são dados legítimos; a reversão só tira a função).
-- =====================================================================
drop function if exists public.cs_set_company_label(uuid, uuid, boolean);

delete from supabase_migrations.schema_migrations
 where name = '0138_cs_set_company_label';
