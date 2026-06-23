-- Passo 8: agenda a geração das tarefas diárias com pg_cron.
-- Habilita o agendador.
create extension if not exists pg_cron;

-- Remove agendamento anterior, se existir (torna a migration idempotente).
select cron.unschedule('generate-daily-tasks')
where exists (select 1 from cron.job where jobname = 'generate-daily-tasks');

-- Agenda a geração das tarefas diárias.
-- '5 3 * * *' em UTC == 00:05 no horário de Brasília (UTC-3, fixo, sem DST).
-- Às 03:05 UTC a data UTC já coincide com a data de Brasília, então
-- current_date corresponde ao dia correto.
select cron.schedule(
  'generate-daily-tasks',
  '5 3 * * *',
  $$ select public.generate_daily_tasks(current_date); $$
);
