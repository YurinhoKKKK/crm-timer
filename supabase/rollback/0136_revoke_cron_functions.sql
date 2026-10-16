-- =====================================================================
-- Reversão de 0136_revoke_cron_functions
-- =====================================================================
-- Restaura o EXECUTE ao estado IMEDIATAMENTE ANTERIOR à 0136:
--   · expire_overdue_standard_tasks: só authenticated (a 0135 já havia revogado
--     public/anon; antes da 0136 tinha auth=true, anon=false, public=false).
--   · as outras 4: public/anon/authenticated (padrão do Supabase) — grant a
--     public cobre os três.
-- =====================================================================
grant execute on function public.expire_overdue_standard_tasks()        to authenticated;
grant execute on function public.generate_daily_tasks(date, boolean)    to public;
grant execute on function public.recompute_attendance(date, date)       to public;
grant execute on function public.attendance_auto_close()                to public;
grant execute on function public.digisac_watchdog()                     to public;

delete from supabase_migrations.schema_migrations
 where name = '0136_revoke_cron_functions';
