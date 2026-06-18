-- =====================================================================
-- CRM/Timer - Monvatti :: Triggers e automações
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ao registrar em auth.users, cria profile com role 'pending'
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'pending'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- 2. updated_at automático
-- ---------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated  before update on profiles
  for each row execute function touch_updated_at();
create trigger trg_companies_updated before update on companies
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Geração de instâncias de tarefas diárias
--    Roda 1x/dia: para cada template diário ativo cujo weekday bate com
--    hoje, cria a task_instance do dia (se ainda não existir).
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
    -- monta o prazo: data alvo + horário-limite (ou 23:59 se não definido)
    due := (target_date::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamptz;

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
-- 4. Ao criar template ÚNICO, gera a instância imediatamente
-- ---------------------------------------------------------------------
create or replace function handle_unique_template()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  due timestamptz;
begin
  if new.kind = 'unica' then
    due := (new.start_date::text || ' ' || coalesce(new.due_time, '23:59')::text)::timestamptz;
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

create trigger trg_unique_template
  after insert on task_templates
  for each row execute function handle_unique_template();

-- ---------------------------------------------------------------------
-- 5. Agendamento diário com pg_cron (00:05 todo dia, horário do servidor UTC)
--    Obs.: o servidor roda em UTC. 00:05 UTC ~ 21:05 BRT do dia anterior.
--    Ajuste o horário conforme preferir após validar o fuso.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'generate-daily-tasks',
  '5 3 * * *',                    -- 03:05 UTC = 00:05 BRT
  $$ select generate_daily_tasks(current_date); $$
);
