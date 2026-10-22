-- =====================================================================
-- 0146 — Revoga EXECUTE de public/anon dos RPCs do timer de reunião (decisão 9)
-- =====================================================================
-- O `create function` do Postgres concede EXECUTE a PUBLIC por padrão. A 0145
-- ADICIONOU `authenticated` mas NÃO revogou esse default, então `anon` ficou com
-- EXECUTE — contra a decisão 9 (nada do tempo de reunião é acessível a anon).
--
-- Aqui fechamos as funções de uso do app: REVOKE de public, anon; `authenticated`
-- permanece (a autorização real continua por dentro de cada função). anon jamais
-- chama estes RPCs — zero impacto funcional.
--
-- Conferência no banco apontou 11 (não 9): as 9 do uso + as duas leituras
-- my_open_meeting_timer() e readable_meeting_timers(), que tinham o mesmo
-- default-PUBLIC. As demais (imported_events_range, meeting_timer_cron,
-- meeting_timer_preempt, helpers) já estavam fechadas na 0145.
--
-- CONVENÇÃO daqui em diante: toda função nova no schema public nasce com
-- `revoke execute ... from public, anon` na MESMA migration (ver 0145 como o
-- caso a não repetir).
-- =====================================================================

revoke execute on function meeting_timer_start(uuid, text, uuid, uuid[])          from public, anon;
revoke execute on function meeting_timer_stop(uuid)                                from public, anon;
revoke execute on function meeting_timer_resume(uuid)                              from public, anon;
revoke execute on function meeting_timer_set_segment(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function meeting_timer_segments_list(uuid)                       from public, anon;
revoke execute on function company_meeting_hours(uuid, date, date)                 from public, anon;
revoke execute on function company_meeting_sessions(uuid, date, date)              from public, anon;
revoke execute on function capacity_person_meetings(uuid, date, date)              from public, anon;
revoke execute on function team_capacity(date, date)                               from public, anon;
-- As duas leituras do timer de reunião pegas na conferência (mesma decisão 9).
revoke execute on function my_open_meeting_timer()                                 from public, anon;
revoke execute on function readable_meeting_timers()                               from public, anon;
