-- =====================================================================
-- 0140_consultor_pode_diaria :: CRM/Timer - Monvatti
-- =====================================================================
-- Consultores voltam a criar tarefas DIÁRIAS (antes só admin — migration 0089,
-- commit e4b9531 "tipo admin-only"). Redefine a função do trigger
-- enforce_task_kind_admin_only para LIBERAR o tipo (única/diária) ao ADMIN e ao
-- CONSULTOR; os demais não-admin (colaborador, gestor de tráfego, desenvolvedor,
-- pending) continuam travados em 'unica' — exatamente como hoje.
--
-- A empresa continua restrita: a policy tt_insert só deixa o consultor inserir
-- em empresa dele (is_admin() OR company_id in my_consultant_companies()) — esta
-- migration NÃO toca em RLS, só na função do trigger.
--
-- O trigger em si (trg_task_kind_admin_only) permanece ligado; só a função muda.
-- Contexto de serviço (auth.uid() nulo: cron, service_role, migrações) passa.
--
-- Reversão: supabase/rollback/0140_consultor_pode_diaria.sql (restaura 0089).
-- =====================================================================
create or replace function public.enforce_task_kind_admin_only()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Serviço (cron/service_role/migração) e quem pode escolher o tipo (admin e
  -- consultor) passam direto.
  if auth.uid() is null or public.auth_role() in ('admin', 'consultor') then
    return new;
  end if;

  -- Demais não-admin: tipo travado em 'unica' (não pode criar nem virar diária).
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
