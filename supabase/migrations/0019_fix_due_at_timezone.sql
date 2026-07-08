-- =====================================================================
-- CRM/Timer - Monvatti :: Correção de fuso no cálculo de due_at
-- =====================================================================
-- BUG: o horário-limite (due_time) que o usuário cadastra é hora-de-parede
-- de Brasília (ex.: 10:30). As funções que montam o prazo concreto (due_at)
-- concatenavam `task_date + due_time` e faziam cast direto para timestamptz:
--
--     (task_date::text || ' ' || due_time::text)::timestamptz
--
-- Esse cast interpreta a string no fuso da SESSÃO do banco (UTC no Supabase).
-- Resultado: 10:30 era gravado como 10:30 UTC (= 07:30 BRT), 3h cedo demais.
-- Consequências: tarefas dentro do prazo apareciam como "atrasadas" e o prazo
-- exibido saía 3h antes do real.
--
-- CORREÇÃO: interpretar a hora-de-parede como America/Sao_Paulo antes de virar
-- instante. `<naive>::timestamp at time zone 'America/Sao_Paulo'` lê o horário
-- como sendo de Brasília e devolve o timestamptz (instante UTC) correto:
--
--     ((task_date::text || ' ' || due_time::text)::timestamp
--        at time zone 'America/Sao_Paulo')
--
-- Aplica-se às 5 funções que constroem due_at + backfill das instâncias já
-- gravadas (todas seguem o padrão bugado; ver guarda no UPDATE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. generate_daily_tasks (recorrência diária)
-- ---------------------------------------------------------------------
create or replace function generate_daily_tasks(target_date date default current_date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  tmpl record;
  created_count integer := 0;
  dow smallint := extract(dow from target_date);  -- 0=domingo
  due timestamptz;
begin
  for tmpl in
    select * from task_templates
    where active = true
      and kind = 'diaria'
      and start_date <= target_date
      and (end_date is null or end_date >= target_date)
      and dow = any(weekdays)
  loop
    -- monta o prazo: data alvo + horário-limite (Brasília; ou 23:59 se não def.)
    due := (
      (target_date::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamp
        at time zone 'America/Sao_Paulo'
    );

    insert into task_instances (
      template_id, company_id, collaborator_id, title, description,
      instructions, due_at, task_date
    )
    values (
      tmpl.id, tmpl.company_id, tmpl.collaborator_id, tmpl.title,
      tmpl.description, tmpl.instructions, due, target_date
    )
    on conflict (template_id, task_date) do nothing;

    if found then
      created_count := created_count + 1;
    end if;
  end loop;

  return created_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. handle_unique_template (instância imediata da tarefa única)
-- ---------------------------------------------------------------------
create or replace function handle_unique_template()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  due timestamptz;
begin
  if new.kind = 'unica' then
    due := (
      (new.start_date::text || ' ' || coalesce(new.due_time, '23:59')::text)::timestamp
        at time zone 'America/Sao_Paulo'
    );
    insert into task_instances (
      template_id, company_id, collaborator_id, title, description,
      instructions, due_at, task_date
    )
    values (
      new.id, new.company_id, new.collaborator_id, new.title,
      new.description, new.instructions, due, new.start_date
    )
    on conflict (template_id, task_date) do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. sync_template_instances (propagação de edição de template)
-- ---------------------------------------------------------------------
create or replace function sync_template_instances(p_template uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  tmpl record;
  updated_count integer := 0;
begin
  select * into tmpl from task_templates where id = p_template;
  if not found then
    return 0;
  end if;

  -- Mesma autorização da policy tt_manage: admin ou consultor da empresa.
  if not (is_admin() or tmpl.company_id in (select my_consultant_companies())) then
    raise exception 'not authorized';
  end if;

  update task_instances ti
  set collaborator_id = tmpl.collaborator_id,
      company_id      = tmpl.company_id,
      title           = tmpl.title,
      description     = tmpl.description,
      instructions    = tmpl.instructions,
      task_date       = case when tmpl.kind = 'unica' then tmpl.start_date else ti.task_date end,
      due_at          = (
        ((case when tmpl.kind = 'unica' then tmpl.start_date else ti.task_date end)::text
          || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamp
          at time zone 'America/Sao_Paulo'
      )
  where ti.template_id = p_template
    and ti.status = 'a_fazer';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. sync_standard_task (vínculo vivo da tarefa padrão)
-- ---------------------------------------------------------------------
create or replace function sync_standard_task(p_standard uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  std record;
  updated_count integer := 0;
begin
  select * into std from standard_tasks where id = p_standard;
  if not found then
    return 0;
  end if;

  if not is_admin() then
    raise exception 'not authorized';
  end if;

  -- 1. campos-molde -> templates ligados
  update task_templates
  set title        = std.title,
      description  = std.description,
      instructions = std.instructions,
      kind         = std.kind,
      weekdays     = case when std.kind = 'diaria' then std.weekdays else '{}' end,
      due_time     = std.due_time
  where standard_task_id = p_standard;

  -- 2. campos -> instâncias ainda a_fazer (congela as demais)
  update task_instances ti
  set title        = std.title,
      description  = std.description,
      instructions = std.instructions,
      due_at       = (
        (ti.task_date::text || ' ' || coalesce(std.due_time, '23:59')::text)::timestamp
          at time zone 'America/Sao_Paulo'
      )
  from task_templates tt
  where ti.template_id = tt.id
    and tt.standard_task_id = p_standard
    and ti.status = 'a_fazer';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. generate_template_today (ocorrência de hoje ao atribuir uma diária)
--    A DECISÃO já era avaliada em Brasília; só o ARMAZENAMENTO estava errado.
-- ---------------------------------------------------------------------
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

  -- prazo do dia: hora-de-parede de Brasília -> instante UTC (mesma fórmula
  -- corrigida do generate_daily_tasks, para consistência com o cron)
  due := (
    (today::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamp
      at time zone 'America/Sao_Paulo'
  );

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

-- ---------------------------------------------------------------------
-- 6. BACKFILL: corrige as instâncias já gravadas com o prazo 3h cedo.
--    Guarda: só toca linhas cujo due_at AINDA é exatamente o valor que a
--    fórmula bugada (cast UTC) produziria — assim não sobrescreve prazos
--    editados manualmente (TaskInstanceEditor grava o instante já correto).
-- ---------------------------------------------------------------------
update task_instances ti
set due_at = (
  (ti.task_date::text || ' ' || coalesce(tt.due_time, '23:59')::text)::timestamp
    at time zone 'America/Sao_Paulo'
)
from task_templates tt
where ti.template_id = tt.id
  and ti.due_at is not null
  and ti.due_at = (
    (ti.task_date::text || ' ' || coalesce(tt.due_time, '23:59')::text)::timestamp
      at time zone 'UTC'
  );
