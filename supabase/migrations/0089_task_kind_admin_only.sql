-- 0089_task_kind_admin_only
--
-- REFORMA DO CADASTRO DE TAREFAS — Parte 2 (trava no banco).
--
-- O TIPO (única/diária) só o ADMIN escolhe. Consultor:
--   - toda tarefa que ele cria nasce ÚNICA;
--   - ele não pode transformar uma tarefa existente em diária (nem as que ele
--     mesmo criou; se editar uma diária criada por admin, o tipo permanece).
--
-- A camada de aplicação (action createTaskTemplate/updateTaskTemplate) já aplica
-- isso, e o formulário esconde o campo para o consultor. Este trigger fecha a
-- porta da API direta (JWT do consultor via PostgREST) — "por nenhum caminho".
--
-- Contextos de serviço (auth.uid() nulo: cron, service_role, migrações) são
-- confiáveis e passam direto, para não quebrar gerações internas.

create or replace function public.enforce_task_kind_admin_only()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.kind := 'unica';
  elsif tg_op = 'UPDATE' then
    -- Consultor não altera o tipo: preserva o que já era.
    if new.kind is distinct from old.kind then
      new.kind := old.kind;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_task_kind_admin_only on task_templates;
create trigger trg_task_kind_admin_only
  before insert or update on task_templates
  for each row execute function public.enforce_task_kind_admin_only();
