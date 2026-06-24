-- =====================================================================
-- Passo 9: correção da exclusão de tarefas
-- =====================================================================
-- Bug: excluir um task_template deixava as task_instances órfãs no banco
-- (FK era ON DELETE SET NULL). As instâncias continuavam aparecendo para
-- consultor/colaborador e alimentando os números do dashboard/resumo, que
-- leem task_instances. A exclusão precisa remover de verdade a tarefa e
-- suas dependências (instâncias, time_entries e activity_log).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Excluir o molde passa a excluir suas instâncias (cascade).
--    time_entries já cascateia de task_instances; activity_log passa a
--    cascatear também (era SET NULL, deixando registros soltos).
-- ---------------------------------------------------------------------
alter table task_instances
  drop constraint task_instances_template_id_fkey,
  add constraint task_instances_template_id_fkey
    foreign key (template_id) references task_templates(id) on delete cascade;

alter table activity_log
  drop constraint activity_log_task_id_fkey,
  add constraint activity_log_task_id_fkey
    foreign key (task_id) references task_instances(id) on delete cascade;

-- ---------------------------------------------------------------------
-- 2. Limpeza única: remove as instâncias órfãs (template_id nulo) que são
--    resíduo das exclusões antigas — os "fantasmas" que ainda apareciam.
--    Toda instância legítima nasce com template_id (trigger da "unica" e
--    generate_daily_tasks), então template_id nulo só existe por causa do
--    antigo ON DELETE SET NULL. Os time_entries/activity_log relacionados
--    saem junto via cascade.
-- ---------------------------------------------------------------------
delete from task_instances where template_id is null;

-- ---------------------------------------------------------------------
-- 3. RLS: regras de exclusão reforçadas no banco (não só na interface).
--    Substitui a política tt_manage (FOR ALL) por políticas por comando,
--    para que o DELETE do consultor fique restrito ao que ele criou.
--    - Admin: exclui qualquer molde.
--    - Consultor: exclui só os moldes que ele mesmo criou (created_by).
--    - Colaborador: não exclui (nunca é admin nem created_by de um molde).
-- ---------------------------------------------------------------------
drop policy tt_manage on task_templates;

create policy tt_insert on task_templates for insert
  with check (
    is_admin()
    or company_id in (select my_consultant_companies())
  );

create policy tt_update on task_templates for update
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
  )
  with check (
    is_admin()
    or company_id in (select my_consultant_companies())
  );

create policy tt_delete on task_templates for delete
  using (
    is_admin()
    or created_by = auth.uid()
  );
