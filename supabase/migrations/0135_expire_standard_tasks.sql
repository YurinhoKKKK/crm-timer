-- =====================================================================
-- 0135_expire_standard_tasks :: CRM/Timer - Monvatti
-- =====================================================================
-- Regra de negócio: tarefas PADRÃO diárias (origem no catálogo standard_tasks,
-- atribuídas no painel da empresa; todas kind 'diaria') que não forem
-- finalizadas são CANCELADAS automaticamente às 11h30 (BRT) do dia seguinte ao
-- task_date. Fim de semana e feriado inclusive (diária de sexta cai no sábado).
--
-- Cancela (status 'cancelada'), NUNCA apaga. time_entries, time_adjustments,
-- activity_log, listing_results, completion_note e total_seconds ficam intactos.
-- Salvaguarda: pula (naquele dia) qualquer tarefa com time_entry ABERTO
-- (ended_at null) — não mexe no timer; registra no NOTICE da execução.
--
-- Reversão: supabase/rollback/0135_expire_standard_tasks.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. task_templates.from_standard — marca de origem no catálogo, PEGAJOSA.
--    Resolve o risco do FK ON DELETE SET NULL: apagar o molde zerava o
--    standard_task_id e tirava a tarefa do escopo. "Uma vez padrão, sempre
--    padrão" — a flag nunca volta a false.
-- ---------------------------------------------------------------------
alter table public.task_templates
  add column if not exists from_standard boolean not null default false;

update public.task_templates
   set from_standard = true
 where standard_task_id is not null and from_standard = false;

create or replace function public.task_templates_from_standard_trg()
returns trigger
language plpgsql
as $fn$
begin
  -- Tem vínculo com o catálogo agora => é padrão.
  if new.standard_task_id is not null then
    new.from_standard := true;
  -- Sem vínculo, mas já era padrão => permanece (nem o ON DELETE SET NULL reverte).
  elsif tg_op = 'UPDATE' and coalesce(old.from_standard, false) then
    new.from_standard := true;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_task_templates_from_standard on public.task_templates;
create trigger trg_task_templates_from_standard
  before insert or update on public.task_templates
  for each row execute function public.task_templates_from_standard_trg();

-- ---------------------------------------------------------------------
-- 2. Auditoria: uma linha por cancelamento automático. RLS ligado, leitura só
--    admin; a ESCRITA é exclusiva da função DEFINER (sem policy de insert).
--    Permite auditar e reverter (por run_id ou por intervalo).
-- ---------------------------------------------------------------------
create table if not exists public.task_auto_expirations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_instances(id) on delete cascade,
  previous_status public.task_status not null,
  expired_at timestamptz not null default now(),
  run_id uuid not null
);
create index if not exists tae_run_idx  on public.task_auto_expirations (run_id);
create index if not exists tae_task_idx on public.task_auto_expirations (task_id);

alter table public.task_auto_expirations enable row level security;

drop policy if exists tae_admin_select on public.task_auto_expirations;
create policy tae_admin_select on public.task_auto_expirations
  for select using ((select is_admin()));

-- ---------------------------------------------------------------------
-- 3. Função de expiração — SECURITY DEFINER, chamada pelo cron (ou manual).
--    Numa transação: seleciona as alvos, grava previous_status na auditoria,
--    cancela, e devolve (run_id, canceladas, puladas_por_timer).
-- ---------------------------------------------------------------------
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
  -- Puladas por timer aberto (salvaguarda) — contadas à parte; não tocamos nelas.
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

  -- 1) Fotografa na auditoria as que SERÃO canceladas (sem timer aberto).
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

  -- 2) Cancela exatamente as auditadas nesta execução.
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

revoke all on function public.expire_overdue_standard_tasks() from public, anon;
-- Sem grant a authenticated: só o cron (owner postgres) a executa.

-- ---------------------------------------------------------------------
-- 4. Leitura do motivo para a tela (PASSO 2c). A tabela de auditoria é
--    admin-only; esta função DEFINER devolve APENAS o expired_at de UMA tarefa
--    que o chamador ALCANÇA (mesmo recorte da visibilidade da tarefa), para o
--    consultor/colaborador ver o motivo sem abrir a auditoria.
-- ---------------------------------------------------------------------
create or replace function public.task_auto_expired_at(p_task uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $fn$
  select ae.expired_at
    from task_auto_expirations ae
    join task_instances ti on ti.id = ae.task_id
   where ae.task_id = p_task
     and ((select is_admin()) or user_reaches_company((select auth.uid()), ti.company_id))
   order by ae.expired_at desc
   limit 1;
$fn$;

revoke all on function public.task_auto_expired_at(uuid) from public, anon;
grant execute on function public.task_auto_expired_at(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Cron diário às 11h30 BRT (14:30 UTC; Brasil sem horário de verão).
-- ---------------------------------------------------------------------
select cron.unschedule('expire-standard-tasks')
 where exists (select 1 from cron.job where jobname = 'expire-standard-tasks');
select cron.schedule('expire-standard-tasks', '30 14 * * *',
  $cron$ select public.expire_overdue_standard_tasks(); $cron$);
