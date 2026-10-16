-- =====================================================================
-- CRM/Timer - Monvatti :: Feriados nacionais na geração diária
-- =====================================================================
-- Em 12/10/2026 (feriado) o cron generate-daily-tasks criou as diárias e elas
-- precisaram ser apagadas. Agora a geração diária NÃO cria tarefas em feriados
-- NACIONAIS.
--
-- A lista de feriados nacionais passa a viver num ÚNICO lugar
-- (is_national_holiday). dev_is_business_day (quadro de Desenvolvimento, 0116)
-- reusa essa lista — resultado IDÊNTICO ao de hoje (sábado/domingo + a mesma
-- lista de feriados). generate_daily_tasks NÃO usa dev_is_business_day: sábado e
-- domingo continuam gerando as diárias; só feriado nacional bloqueia (salvo
-- p_force, para quando a equipe trabalhar num feriado).
--
-- Carnaval, Corpus Christi e feriados estaduais/municipais NÃO bloqueiam.
-- =====================================================================

-- 1) Feriados NACIONAIS (não olha fim de semana). IMMUTABLE, search_path fixo.
create or replace function is_national_holiday(d date)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_mmdd text := to_char(d, 'MM-DD');
begin
  -- Sexta-feira Santa (móvel): 2 dias antes da Páscoa.
  if d = dev_easter(extract(year from d)::int) - 2 then
    return true;
  end if;
  return v_mmdd in (
    '01-01',  -- Confraternização Universal
    '04-21',  -- Tiradentes
    '05-01',  -- Dia do Trabalho
    '09-07',  -- Independência
    '10-12',  -- N. Sra. Aparecida
    '11-02',  -- Finados
    '11-15',  -- Proclamação da República
    '11-20',  -- Consciência Negra
    '12-25'   -- Natal
  );
end;
$$;

-- 2) dev_is_business_day passa a reusar is_national_holiday (lista em um lugar
--    só). Mesmo resultado de antes: sábado/domingo + os mesmos feriados.
create or replace function dev_is_business_day(d date)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  if extract(isodow from d) in (6, 7) then
    return false;  -- sábado / domingo
  end if;
  if is_national_holiday(d) then
    return false;  -- feriado nacional (inclui Sexta-feira Santa)
  end if;
  return true;
end;
$$;

-- 3) generate_daily_tasks: bloqueia feriado nacional (salvo p_force). Mudança de
--    ASSINATURA → DROP da antiga (sem overload, para não ficar ambígua). O resto
--    da função é idêntico ao de hoje; só a checagem no início é nova.
drop function if exists generate_daily_tasks(date);

create or replace function generate_daily_tasks(
  target_date date default current_date,
  p_force boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tmpl record;
  created_count integer := 0;
  dow smallint := extract(dow from target_date);
  due timestamptz;
begin
  -- Feriado nacional: ignora a geração (sábado/domingo NÃO bloqueiam aqui).
  if is_national_holiday(target_date) and not p_force then
    raise notice 'Feriado nacional: geração ignorada para %', target_date;
    return 0;
  end if;

  for tmpl in
    select * from task_templates
    where active = true
      and paused_by_group = false
      and kind = 'diaria'
      and start_date <= target_date
      and (end_date is null or end_date >= target_date)
      and dow = any(weekdays)
  loop
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

-- Restaura os grants da função (o DROP os leva junto). O comando do cron
-- (select public.generate_daily_tasks(current_date)) continua igual, pelo default
-- de p_force.
grant execute on function generate_daily_tasks(date, boolean)
  to anon, authenticated, service_role;
