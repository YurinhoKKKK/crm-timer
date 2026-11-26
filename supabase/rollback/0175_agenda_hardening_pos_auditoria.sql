-- =====================================================================
-- ROLLBACK da 0175 — volta ao estado pós-0174.
--   · dropa o guard de UPDATE e a RPC meetings_set_sync (o front novo depende
--     dela: só reverta junto com o front correspondente);
--   · meetings_timer_sync volta a propagar só horários (0147);
--   · dropa o snapshot de timers; o CHECK de event_type volta ao domínio 0168
--     (remove antes os snapshots gravados, que o constraint antigo não aceita).
-- =====================================================================

drop trigger if exists trg_meetings_guard_update on meetings;
drop function if exists meetings_guard_update();

drop function if exists meetings_set_sync(uuid, text, text, boolean, text, text, text);

create or replace function meetings_timer_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update meeting_timers set scheduled_start = new.starts_at, scheduled_end = new.ends_at
   where meeting_id = new.id;
  return new;
end; $$;

drop trigger if exists trg_meetings_timer_sync on meetings;
create trigger trg_meetings_timer_sync
  after update of starts_at, ends_at on meetings
  for each row execute function meetings_timer_sync();

drop trigger if exists trg_meeting_timers_snapshot on meeting_timers;
drop function if exists meeting_timers_snapshot_trg();
delete from meeting_timer_audit where event_type = 'company_delete';
alter table meeting_timer_audit drop constraint meeting_timer_audit_event_type_check;
alter table meeting_timer_audit add constraint meeting_timer_audit_event_type_check
  check (event_type = any (array['edit'::text, 'auto_close'::text]));
