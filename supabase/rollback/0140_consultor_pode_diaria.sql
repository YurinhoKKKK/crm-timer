-- =====================================================================
-- Reversão de 0140_consultor_pode_diaria
-- =====================================================================
-- Restaura a função do trigger ao estado da 0089 (só admin escolhe o tipo;
-- consultor e demais não-admin travados em 'unica'). Não desfaz tarefas já
-- criadas.
-- =====================================================================
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
    if new.kind is distinct from old.kind then
      new.kind := old.kind;
    end if;
  end if;

  return new;
end;
$function$;

delete from supabase_migrations.schema_migrations
 where name = '0140_consultor_pode_diaria';
