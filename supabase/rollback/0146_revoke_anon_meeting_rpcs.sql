-- =====================================================================
-- ROLLBACK da 0146 — restaura o EXECUTE a anon nos RPCs do timer de reunião.
-- =====================================================================
-- Reverte o REVOKE da 0146 (volta ao estado pós-0145, em que anon tinha EXECUTE
-- via default PUBLIC). `authenticated` nunca foi tocado. Use só para desfazer a
-- 0146 — a decisão 9 pede que anon NÃO tenha EXECUTE, então isto é apenas a volta.
-- =====================================================================

grant execute on function meeting_timer_start(uuid, text, uuid, uuid[])          to anon;
grant execute on function meeting_timer_stop(uuid)                                to anon;
grant execute on function meeting_timer_resume(uuid)                              to anon;
grant execute on function meeting_timer_set_segment(uuid, timestamptz, timestamptz) to anon;
grant execute on function meeting_timer_segments_list(uuid)                       to anon;
grant execute on function company_meeting_hours(uuid, date, date)                 to anon;
grant execute on function company_meeting_sessions(uuid, date, date)              to anon;
grant execute on function capacity_person_meetings(uuid, date, date)              to anon;
grant execute on function team_capacity(date, date)                               to anon;
grant execute on function my_open_meeting_timer()                                 to anon;
grant execute on function readable_meeting_timers()                               to anon;
