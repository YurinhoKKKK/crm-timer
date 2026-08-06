-- =====================================================================
-- Gerar a ocorrência de HOJE ao EDITAR uma diária (com status em texto).
--
-- PROBLEMA: o pg_cron (generate_daily_tasks, 00:05) e o trigger AFTER INSERT
-- (trg_diaria_template_today → generate_template_today) geram a instância de
-- hoje. Mas EDITAR o template não dispara nada — sync_template_instances só faz
-- UPDATE das instâncias 'a_fazer' já existentes. Então incluir "quinta" numa
-- diária depois que o cron já rodou deixava o dia sem a tarefa, em silêncio.
--
-- Esta função é o caminho de EDIÇÃO, chamada pelo app APÓS o UPDATE do template
-- (a autorização já veio da RLS tt_manage naquele UPDATE). Difere de
-- generate_template_today em dois pontos, de propósito:
--   1) IGNORA o due_time: na edição manual a pessoa corrige AGORA (ex.: 14h);
--      recusar por horário reproduziria o mesmo problema num recorte mais
--      confuso. A tarefa pode nascer ATRASADA — está correto, foi cadastrada
--      tarde. (O cron e o trigger de INSERT continuam respeitando o due_time:
--      NÃO mexemos em generate_template_today.)
--   2) Retorna um STATUS em texto (não booleano), para o TaskEditor explicar o
--      que aconteceu em vez de silêncio:
--        'gerada' | 'ja_existia' | 'nao_e_dia' | 'inativa' | 'fora_do_periodo'
--        | 'nao_aplica' (não é diária / não encontrada).
--
-- NÃO duplica: mesmo on conflict (template_id, task_date) do nothing — vale
-- inclusive contra a instância que o cron já tenha criado. task_date/due_at usam
-- a MESMA fórmula do cron, então a instância nasce idêntica à dele.
-- =====================================================================
create or replace function generate_template_today_edit(p_template uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  tmpl     record;
  today    date     := (timezone('America/Sao_Paulo', now()))::date;
  dow      smallint := extract(dow from (timezone('America/Sao_Paulo', now()))::date);
  due      timestamptz;
  inserted integer := 0;
begin
  -- Só diárias têm geração de "hoje" por recorrência (única/listagem seguem a
  -- start_date, tratada noutro caminho).
  select * into tmpl
    from task_templates
   where id = p_template
     and kind = 'diaria';
  if not found then
    return 'nao_aplica';
  end if;

  if not tmpl.active then
    return 'inativa';
  end if;

  if not (dow = any(tmpl.weekdays)) then
    return 'nao_e_dia';
  end if;

  if tmpl.start_date > today
     or (tmpl.end_date is not null and tmpl.end_date < today) then
    return 'fora_do_periodo';
  end if;

  -- due_at pela MESMA fórmula do generate_daily_tasks (consistência com o cron):
  -- a tarefa fica devida no horário-limite de HOJE. Se já passou, nasce atrasada
  -- — comportamento desejado neste caminho.
  due := (today::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamptz;

  insert into task_instances (
    template_id, company_id, collaborator_id, title, description,
    instructions, due_at, task_date
  )
  values (
    tmpl.id, tmpl.company_id, tmpl.collaborator_id, tmpl.title,
    tmpl.description, tmpl.instructions, due, today
  )
  on conflict (template_id, task_date) do nothing;

  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'gerada' else 'ja_existia' end;
end;
$$;

revoke execute on function generate_template_today_edit(uuid) from public, anon;
grant  execute on function generate_template_today_edit(uuid) to authenticated;
