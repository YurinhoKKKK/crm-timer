-- =====================================================================
-- Passo 10: índices nas foreign keys mais consultadas
-- =====================================================================
-- O advisor de performance do Supabase aponta FKs sem índice de cobertura.
-- No volume atual (poucas linhas) isso não causa lentidão perceptível — a
-- lentidão de navegação é de frontend (resolvida com os loading.tsx) — mas
-- são índices baratos que evitam scans quando os dados crescerem e aceleram
-- os joins/filtros já usados pelas telas e pelas políticas RLS.
-- =====================================================================

-- task_templates: filtrado por empresa (admin/consultor), colaborador e
-- created_by (usado na política tt_delete e nas listagens).
create index if not exists idx_task_templates_company       on task_templates(company_id);
create index if not exists idx_task_templates_collaborator   on task_templates(collaborator_id);
create index if not exists idx_task_templates_created_by      on task_templates(created_by);

-- activity_log: consultado por colaborador e por tarefa (cascade/joins).
create index if not exists idx_activity_log_collaborator     on activity_log(collaborator_id);
create index if not exists idx_activity_log_task             on activity_log(task_id);

-- time_entries: já há índice por task_id; falta o de colaborador.
create index if not exists idx_time_entries_collaborator     on time_entries(collaborator_id);
