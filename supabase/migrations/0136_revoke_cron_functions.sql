-- =====================================================================
-- 0136_revoke_cron_functions :: CRM/Timer - Monvatti
-- =====================================================================
-- Endurecimento de segurança. Estas 5 funções SECURITY DEFINER são chamadas
-- SÓ pelo cron (como postgres) e NÃO são chamadas pelo app. Pelo padrão de
-- privilégios do Supabase elas tinham EXECUTE para public/anon/authenticated,
-- então qualquer usuário logado podia dispará-las via /rpc. Revogamos esse
-- EXECUTE. O owner (postgres) e, portanto, o cron continuam executando — a
-- revogação não afeta o dono da função.
--
-- A LÓGICA de nenhuma função muda. move_expired_active_to_renewal já estava
-- correta (sem EXECUTE para authenticated) e não é tocada.
--
-- Reversão: supabase/rollback/0136_revoke_cron_functions.sql
-- =====================================================================
revoke execute on function public.expire_overdue_standard_tasks()        from public, anon, authenticated;
revoke execute on function public.generate_daily_tasks(date, boolean)    from public, anon, authenticated;
revoke execute on function public.recompute_attendance(date, date)       from public, anon, authenticated;
revoke execute on function public.attendance_auto_close()                from public, anon, authenticated;
revoke execute on function public.digisac_watchdog()                     from public, anon, authenticated;
