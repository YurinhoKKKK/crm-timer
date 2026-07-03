-- =====================================================================
-- Trigger: ao atribuir/inserir um template DIÁRIO, gera a ocorrência de HOJE
-- =====================================================================
-- Complemento da 0013. Aquela migration criou a função generate_template_today
-- (decide e insere a instância de hoje para uma diária, se hoje for um dia
-- marcado E ainda dentro do due_time). Faltava o gatilho que a chama.
--
-- Espelha o trg_unique_template (0003), que já faz o mesmo para as tarefas
-- ÚNICAS na sua start_date. Rodar por trigger AFTER INSERT — e não via RPC do
-- app — garante que a instância de hoje nasça na MESMA transação do insert do
-- template, independente do fluxo que o criou (atribuição de padrão, cadastro
-- avulso de diária, etc.). Duplicidade é impossível: generate_template_today
-- insere com on conflict (template_id, task_date) do nothing, então o cron das
-- 00:05 (generate_daily_tasks) e este gatilho nunca geram a mesma instância.
-- =====================================================================

create or replace function handle_diaria_template_today()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform generate_template_today(new.id);
  return new;
end;
$$;

drop trigger if exists trg_diaria_template_today on task_templates;
create trigger trg_diaria_template_today
  after insert on task_templates
  for each row
  when (new.kind = 'diaria' and new.active = true)
  execute function handle_diaria_template_today();
