-- =====================================================================
-- CRM/Timer - Monvatti :: Funções do timer do colaborador
-- =====================================================================
-- SECURITY INVOKER (padrão): rodam com as permissões do usuário, então a RLS
-- continua valendo (cada colaborador só mexe nas próprias tarefas/intervalos).
-- O tempo é sempre o do servidor, evitando manipulação pelo relógio do cliente.
-- =====================================================================

-- Inicia (play): abre um time_entry se não houver um aberto; marca a tarefa
-- como 'iniciada'. Retorna o started_at do intervalo aberto.
create or replace function timer_start(p_task uuid)
returns timestamptz
language plpgsql
as $$
declare
  v_collab uuid := auth.uid();
  v_status task_status;
  v_started timestamptz;
begin
  select status into v_status from task_instances
    where id = p_task and collaborator_id = v_collab;
  if v_status is null then
    raise exception 'tarefa nao encontrada';
  end if;
  if v_status in ('finalizada','cancelada') then
    raise exception 'tarefa ja encerrada';
  end if;

  select started_at into v_started from time_entries
    where task_id = p_task and collaborator_id = v_collab and ended_at is null
    order by started_at desc limit 1;
  if v_started is not null then
    return v_started; -- já está rodando
  end if;

  insert into time_entries (task_id, collaborator_id, started_at)
    values (p_task, v_collab, now())
    returning started_at into v_started;

  update task_instances
    set status = 'iniciada',
        started_at = coalesce(started_at, now())
    where id = p_task and collaborator_id = v_collab;

  return v_started;
end;
$$;

-- Pausa: fecha o intervalo aberto (ended_at, seconds) e recalcula o total
-- a partir da soma dos intervalos fechados. Retorna o total_seconds.
create or replace function timer_pause(p_task uuid)
returns integer
language plpgsql
as $$
declare
  v_collab uuid := auth.uid();
  v_total integer;
begin
  update time_entries
    set ended_at = now(),
        seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
    where task_id = p_task and collaborator_id = v_collab and ended_at is null;

  select coalesce(sum(seconds), 0) into v_total from time_entries
    where task_id = p_task and collaborator_id = v_collab and seconds is not null;

  update task_instances set total_seconds = v_total
    where id = p_task and collaborator_id = v_collab;

  return v_total;
end;
$$;

-- Finaliza: fecha qualquer intervalo aberto, marca a tarefa como finalizada
-- com a nota, grava finished_at e registra no activity_log. p_send apenas
-- marca a intenção de WhatsApp (o envio real é o Passo 5).
create or replace function timer_finish(p_task uuid, p_note text, p_send boolean)
returns integer
language plpgsql
as $$
declare
  v_collab uuid := auth.uid();
  v_total integer;
  v_company uuid;
begin
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'resumo obrigatorio';
  end if;

  update time_entries
    set ended_at = now(),
        seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
    where task_id = p_task and collaborator_id = v_collab and ended_at is null;

  select coalesce(sum(seconds), 0) into v_total from time_entries
    where task_id = p_task and collaborator_id = v_collab and seconds is not null;

  update task_instances
    set status = 'finalizada',
        total_seconds = v_total,
        completion_note = p_note,
        finished_at = now(),
        note_sent_whatsapp = p_send
    where id = p_task and collaborator_id = v_collab
    returning company_id into v_company;

  if v_company is null then
    raise exception 'tarefa nao encontrada';
  end if;

  insert into activity_log
    (company_id, task_id, collaborator_id, message, seconds_spent, sent_whatsapp)
  values
    (v_company, p_task, v_collab, p_note, v_total, p_send);

  return v_total;
end;
$$;
