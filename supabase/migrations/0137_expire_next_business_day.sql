-- =====================================================================
-- 0137_expire_next_business_day :: CRM/Timer - Monvatti
-- =====================================================================
-- Ajuste da rotina de expiração de tarefas PADRÃO diárias (0135).
--
-- ANTES (0135): cancelava toda tarefa padrão diária em aberto com
--   task_date <= ontem (BRT). Em 17/10 (sábado) isso cancelou 4 diárias de
--   sexta 16/10 num dia em que ninguém estava trabalhando para auditar.
--
-- AGORA: o cancelamento só ocorre às 11h30 do PRÓXIMO DIA ÚTIL após o
--   task_date. Dia útil = segunda a sexta, exceto feriado NACIONAL, usando a
--   mesma is_national_holiday()/dev_is_business_day() da geração diária (0127).
--   Feriados regionais ficam de fora.
--
-- Critério novo: cancela quando next_business_day(task_date) <= hoje (BRT).
--   Em sábado, domingo e feriado nacional a função não cancela nada — retorna
--   cancelled = 0 logo no início (hoje não é dia útil). Todo o resto do
--   critério da 0135 continua igual: from_standard, kind 'diaria', status
--   a_fazer/iniciada, salvaguarda de timer aberto, fotografia em
--   task_auto_expirations, cancela (status 'cancelada') e nunca apaga.
--
-- O cron ('expire-standard-tasks', '30 14 * * *', todo dia) NÃO muda — só a
-- função. As 5 funções só-cron continuam sem EXECUTE para public/anon/
-- authenticated (0136); o REVOKE é reafirmado abaixo.
--
-- As 4 tarefas canceladas em 17/10 (run b5042215-0675-406d-93d0-ab959d2ecdcd)
-- ficam como estão — esta migration não as reabre.
--
-- Reversão: supabase/rollback/0137_expire_next_business_day.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. next_business_day(d) — menor data > d que seja dia útil (segunda a sexta
--    e NÃO feriado nacional). Reusa dev_is_business_day (0127), fonte única da
--    regra de "dia útil" (fim de semana + os mesmos feriados nacionais).
--    STABLE (não IMMUTABLE): depende da lista de feriados, mesmo que hoje ela
--    seja determinística; STABLE é o rótulo honesto. search_path fixo.
-- ---------------------------------------------------------------------
create or replace function public.next_business_day(d date)
returns date
language plpgsql
stable
set search_path = public
as $fn$
declare
  nd date := d + 1;
begin
  while not dev_is_business_day(nd) loop
    nd := nd + 1;
  end loop;
  return nd;
end;
$fn$;

-- Função auxiliar de regra de negócio; não é chamada pelo app. Sem EXECUTE
-- para public/anon/authenticated (só o owner postgres, via a função abaixo).
revoke all on function public.next_business_day(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Recria expire_overdue_standard_tasks() — MESMA assinatura e MESMO retorno
--    da 0135. Muda apenas: (a) guarda de "hoje é dia útil" no início e (b) o
--    critério de vencimento passa de "task_date <= ontem" para
--    "next_business_day(task_date) <= hoje".
-- ---------------------------------------------------------------------
create or replace function public.expire_overdue_standard_tasks()
returns table(run_id uuid, cancelled integer, skipped_open_timer integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_run_id uuid := gen_random_uuid();
  v_today  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cancelled integer := 0;
  v_skipped integer := 0;
begin
  -- Hoje não é dia útil (sábado/domingo/feriado nacional): não cancela nada.
  if not dev_is_business_day(v_today) then
    run_id := v_run_id;
    cancelled := 0;
    skipped_open_timer := 0;
    return next;
    return;
  end if;

  -- Puladas por timer aberto (salvaguarda) — contadas à parte; não tocamos nelas.
  select count(*) into v_skipped
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where tt.from_standard = true
     and tt.kind = 'diaria'
     and ti.status in ('a_fazer', 'iniciada')
     and next_business_day(ti.task_date) <= v_today
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
          and next_business_day(ti.task_date) <= v_today
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
     and next_business_day(ti.task_date) <= v_today
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

-- Reafirma a revogação da 0136 (create or replace preserva a ACL, mas deixamos
-- explícito): só o cron (owner postgres) executa.
revoke all on function public.expire_overdue_standard_tasks() from public, anon, authenticated;

-- O cron NÃO muda (continua '30 14 * * *', todo dia). Nada de cron.schedule aqui.
