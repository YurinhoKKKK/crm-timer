-- =====================================================================
-- ROLLBACK da 0163 — remove as RPCs do detalhe do colaborador (aditiva).
-- =====================================================================

drop function if exists public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int);
drop function if exists public.collaborator_task_facets(uuid, date, date);
drop function if exists public.collaborator_pending_tasks(uuid, date, date);
