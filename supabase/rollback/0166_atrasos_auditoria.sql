-- === ROLLBACK da 0166 — remove as RPCs de Atrasos (puramente aditiva) ===
-- Volta ao estado pós-0165: nenhuma das funções abaixo existia antes.
drop function if exists public.atrasos_cell_tasks(date, date, text, uuid, text, boolean, text, uuid, uuid, uuid, text, text, int, int);
drop function if exists public.atrasos_dashboard(date, date);
drop function if exists public.atrasos_summary(date, date, boolean, text, uuid, uuid, uuid, text, text);
drop function if exists public.atrasos_list(date, date, boolean, text, uuid, uuid, uuid, text, text, text, int, int);
drop function if exists public.atrasos_facets(date, date, boolean);
drop function if exists public.atrasos_excluded_ids();
