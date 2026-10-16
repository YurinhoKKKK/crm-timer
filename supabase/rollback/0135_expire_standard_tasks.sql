-- =====================================================================
-- Reversão de 0135_expire_standard_tasks
-- =====================================================================
-- Restaura as tarefas canceladas por ESTA rotina a partir de
-- task_auto_expirations (só as que ela cancelou — as 37 canceladas antigas NÃO
-- estão na auditoria e ficam intactas). Depois remove o cron, as funções, o
-- trigger, a coluna from_standard, a tabela de auditoria e o registro da
-- migration.
--
-- Reversão TOTAL por padrão. Para reverter só UMA execução, descomente o filtro
-- por run_id nos passos 1 e troque o DROP da tabela por um delete por run_id.
-- =====================================================================

-- 1) Restaura o previous_status das canceladas registradas.
update public.task_instances ti
   set status = ae.previous_status
  from public.task_auto_expirations ae
 where ae.task_id = ti.id
   and ti.status = 'cancelada'
   -- and ae.run_id = '<RUN_ID>'   -- descomente p/ reverter só uma execução
;

-- 2) Remove o cron.
select cron.unschedule('expire-standard-tasks')
 where exists (select 1 from cron.job where jobname = 'expire-standard-tasks');

-- 3) Remove funções, trigger, coluna e tabela de auditoria.
drop function if exists public.expire_overdue_standard_tasks();
drop function if exists public.task_auto_expired_at(uuid);
drop trigger if exists trg_task_templates_from_standard on public.task_templates;
drop function if exists public.task_templates_from_standard_trg();
alter table public.task_templates drop column if exists from_standard;
drop table if exists public.task_auto_expirations;

-- 4) Remove o registro da migration.
delete from supabase_migrations.schema_migrations
 where name = '0135_expire_standard_tasks';
