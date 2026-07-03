-- =====================================================================
-- Ajuste: geração da ocorrência de HOJE ao atribuir uma tarefa padrão
-- =====================================================================
-- Contexto (Passo 15): atribuir uma tarefa padrão a uma empresa cria um
-- task_template ligado. Para tarefas ÚNICAS o trigger trg_unique_template já
-- gera a instância na hora (em start_date). Para DIÁRIAS, porém, nada era
-- gerado na atribuição — a instância de hoje só nascia na próxima execução do
-- generate_daily_tasks (cron 00:05). Resultado: uma diária atribuída de manhã
-- só "aparecia" no dia seguinte.
--
-- Regra desejada:
--   - Única: sempre gera a ocorrência no dia da atribuição (start_date=hoje,
--     tratado no app + trigger existente).
--   - Diária: gera a ocorrência de HOJE se, e somente se, hoje for um dos dias
--     marcados (weekdays) E ainda estivermos dentro do horário-limite
--     (due_time). Caso contrário, segue a recorrência normal (o cron cuida do
--     próximo dia válido).
--
-- Fuso: a DECISÃO ("é hoje um dia marcado?" e "ainda dá tempo?") é avaliada no
-- horário de Brasília (America/Sao_Paulo) — é como o usuário lê o relógio e o
-- horário-limite. Já o ARMAZENAMENTO de task_date/due_at segue exatamente a
-- mesma fórmula do generate_daily_tasks, para as instâncias geradas aqui
-- ficarem idênticas às que o cron produziria.
-- =====================================================================

create or replace function generate_template_today(p_template uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  tmpl        record;
  brt_now     timestamp := timezone('America/Sao_Paulo', now());  -- relógio de Brasília
  today       date       := (timezone('America/Sao_Paulo', now()))::date;
  dow         smallint   := extract(dow from (timezone('America/Sao_Paulo', now()))::date);
  due         timestamptz;
  inserted    integer := 0;
begin
  select * into tmpl
    from task_templates
   where id = p_template
     and active = true
     and kind = 'diaria';
  if not found then
    return false;
  end if;

  -- hoje precisa ser um dos dias marcados
  if not (dow = any(tmpl.weekdays)) then
    return false;
  end if;

  -- respeita a janela de vigência do template
  if tmpl.start_date > today
     or (tmpl.end_date is not null and tmpl.end_date < today) then
    return false;
  end if;

  -- ainda dentro do horário-limite (relógio de Brasília vs due_time como
  -- hora-de-parede). Sem due_time = vale o dia inteiro.
  if brt_now::time > coalesce(tmpl.due_time, time '23:59:59') then
    return false;
  end if;

  -- prazo do dia: MESMA fórmula do generate_daily_tasks (consistência com o cron)
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
  return inserted > 0;
end;
$$;

grant execute on function generate_template_today(uuid) to authenticated;
