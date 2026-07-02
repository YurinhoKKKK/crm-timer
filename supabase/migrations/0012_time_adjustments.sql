-- =====================================================================
-- Passo 16: Correção de tempo pelo admin (com auditoria)
-- =====================================================================
-- O admin pode corrigir o tempo total de uma tarefa (casos em que alguém
-- esqueceu de pausar/finalizar o timer). Toda correção é registrada em
-- time_adjustments (quem, quando, valor anterior e novo, motivo).
--
-- Reconciliação dos intervalos: como timer_pause/timer_finish recalculam
-- total_seconds a partir da soma dos time_entries, um ajuste que só mudasse
-- total_seconds seria perdido se a tarefa fosse retomada. Por isso a função
-- fecha qualquer intervalo aberto e insere um intervalo de reconciliação com
-- o delta, mantendo a soma dos time_entries igual ao novo total.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Log de auditoria das correções
-- ---------------------------------------------------------------------
create table time_adjustments (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid not null references task_instances(id) on delete cascade,
  adjusted_by uuid not null references profiles(id),
  old_seconds integer not null,
  new_seconds integer not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index idx_time_adjustments_task on time_adjustments(task_id);

alter table time_adjustments enable row level security;

-- Admin lê tudo; o colaborador dono da tarefa vê os ajustes da própria tarefa
-- (transparência). Ninguém insere direto — só a função SECURITY DEFINER grava.
create policy ta_select on time_adjustments for select
  using (
    is_admin()
    or task_id in (select id from task_instances where collaborator_id = auth.uid())
    or task_id in (select id from task_instances
                   where company_id in (select my_consultant_companies()))
  );

-- ---------------------------------------------------------------------
-- 2. Função de ajuste (só admin; reforçado no banco)
-- ---------------------------------------------------------------------
create or replace function admin_adjust_time(
  p_task uuid,
  p_new_seconds integer,
  p_reason text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_old integer;
  v_collab uuid;
  v_sum integer;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if p_new_seconds is null or p_new_seconds < 0 then
    raise exception 'tempo invalido';
  end if;

  select total_seconds, collaborator_id into v_old, v_collab
    from task_instances where id = p_task;
  if not found then
    raise exception 'tarefa nao encontrada';
  end if;

  -- Fecha qualquer intervalo aberto (o "esqueceu de pausar" para de correr).
  update time_entries
    set ended_at = now(),
        seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
    where task_id = p_task and ended_at is null;

  -- Reconcilia: soma atual dos intervalos fechados.
  select coalesce(sum(seconds), 0) into v_sum from time_entries
    where task_id = p_task and seconds is not null;

  -- Intervalo de reconciliação com o delta para a soma bater com o novo total.
  if p_new_seconds <> v_sum then
    insert into time_entries (task_id, collaborator_id, started_at, ended_at, seconds)
      values (p_task, v_collab, now(), now(), p_new_seconds - v_sum);
  end if;

  update task_instances set total_seconds = p_new_seconds where id = p_task;

  insert into time_adjustments (task_id, adjusted_by, old_seconds, new_seconds, reason)
    values (p_task, v_admin, v_old, p_new_seconds,
            nullif(btrim(coalesce(p_reason, '')), ''));

  return p_new_seconds;
end;
$$;

grant execute on function admin_adjust_time(uuid, integer, text) to authenticated;
