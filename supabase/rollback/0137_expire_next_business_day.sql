-- =====================================================================
-- Reversão de 0137_expire_next_business_day
-- =====================================================================
-- Volta ao estado da 0135/0136:
--   1) Restaura a definição ANTERIOR de expire_overdue_standard_tasks
--      (critério "task_date <= ontem", copiada da 0135) e reafirma o REVOKE.
--   2) Remove a função next_business_day.
--   3) Remove o registro da migration.
--
-- O texto exibido no TaskDetailSheet ("do próximo dia útil" -> "do dia
-- seguinte") volta no código (git), não no banco.
--
-- NÃO reabre tarefas: nenhum cancelamento é desfeito aqui (o cancelamento é o
-- mesmo nas duas versões; muda só QUANDO acontece).
-- =====================================================================

-- 1) Restaura a definição da 0135 (idêntica à que estava no banco antes da 0137).
create or replace function public.expire_overdue_standard_tasks()
returns table(run_id uuid, cancelled integer, skipped_open_timer integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_run_id uuid := gen_random_uuid();
  v_cutoff date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_cancelled integer := 0;
  v_skipped integer := 0;
begin
  select count(*) into v_skipped
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where tt.from_standard = true
     and tt.kind = 'diaria'
     and ti.status in ('a_fazer', 'iniciada')
     and ti.task_date <= v_cutoff
     and exists (select 1 from time_entries te
                  where te.task_id = ti.id and te.ended_at is null);

  if v_skipped > 0 then
    raise notice 'expire_overdue_standard_tasks run %: % tarefa(s) puladas por timer aberto: %',
      v_run_id, v_skipped,
      (select array_agg(ti.id)
         from task_instances ti
         join task_templates tt on tt.id = ti.template_id
        where tt.from_standard = true and tt.kind = 'diaria'
          and ti.status in ('a_fazer', 'iniciada')
          and ti.task_date <= v_cutoff
          and exists (select 1 from time_entries te
                       where te.task_id = ti.id and te.ended_at is null));
  end if;

  insert into task_auto_expirations (task_id, previous_status, run_id)
  select ti.id, ti.status, v_run_id
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where tt.from_standard = true
     and tt.kind = 'diaria'
     and ti.status in ('a_fazer', 'iniciada')
     and ti.task_date <= v_cutoff
     and not exists (select 1 from time_entries te
                      where te.task_id = ti.id and te.ended_at is null);

  update task_instances
     set status = 'cancelada'
   where id in (select ae.task_id from task_auto_expirations ae
                 where ae.run_id = v_run_id);
  get diagnostics v_cancelled = row_count;

  run_id := v_run_id;
  cancelled := v_cancelled;
  skipped_open_timer := v_skipped;
  return next;
end;
$fn$;

revoke all on function public.expire_overdue_standard_tasks() from public, anon, authenticated;

-- 2) Remove a função auxiliar.
drop function if exists public.next_business_day(date);

-- 3) Remove o registro da migration.
delete from supabase_migrations.schema_migrations
 where name = '0137_expire_next_business_day';
