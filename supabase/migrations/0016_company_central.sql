-- =====================================================================
-- Passo 19 (roteiro): Central da empresa — agregados escaláveis
-- =====================================================================
-- A central da empresa (admin e consultor) precisa de contagens por status,
-- tempo total/mês/período e resumo por colaborador SEM carregar milhares de
-- instâncias no servidor (uma empresa antiga acumula muitas ocorrências
-- diárias). Fazemos a agregação no banco, com índice de cobertura.
--
-- As funções são SECURITY INVOKER de propósito: a RLS de task_instances
-- (ti_select) já escopa — admin vê tudo; consultor só as empresas dele. Se a
-- empresa não for do consultor, os agregados voltam zerados; ainda assim a
-- página bloqueia o acesso antes, via companies_select (retorna null → 404).
-- =====================================================================

-- Índice composto para agregar/filtrar por empresa dentro de um período.
create index if not exists idx_task_instances_company_date
  on task_instances(company_id, task_date);

-- ---------------------------------------------------------------------
-- Visão-resumo de uma empresa.
-- Contagens e seconds_period respeitam o período (task_date >= p_start), para
-- bater com o dashboard. seconds_month (mês atual) e seconds_all (tempo total
-- da empresa) são independentes do período, conforme o roteiro.
-- overdue = a fazer/iniciada com prazo vencido, dentro do período — mesma
-- definição do dashboard.
-- ---------------------------------------------------------------------
create or replace function company_overview(
  p_company_id uuid,
  p_start date,
  p_month_start date
)
returns table (
  total bigint,
  a_fazer bigint,
  iniciada bigint,
  finalizada bigint,
  cancelada bigint,
  overdue bigint,
  seconds_period bigint,
  seconds_month bigint,
  seconds_all bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where p_start is null or task_date >= p_start),
    count(*) filter (where status = 'a_fazer'    and (p_start is null or task_date >= p_start)),
    count(*) filter (where status = 'iniciada'   and (p_start is null or task_date >= p_start)),
    count(*) filter (where status = 'finalizada' and (p_start is null or task_date >= p_start)),
    count(*) filter (where status = 'cancelada'  and (p_start is null or task_date >= p_start)),
    count(*) filter (
      where status in ('a_fazer', 'iniciada')
        and due_at < now()
        and (p_start is null or task_date >= p_start)
    ),
    coalesce(sum(total_seconds) filter (where p_start is null or task_date >= p_start), 0),
    coalesce(sum(total_seconds) filter (where task_date >= p_month_start), 0),
    coalesce(sum(total_seconds), 0)
  from task_instances
  where company_id = p_company_id;
$$;

-- ---------------------------------------------------------------------
-- Resumo por colaborador dentro da empresa (no período). Junta o perfil para
-- nome/avatar; a RLS de profiles permite ao consultor ler colaborador/admin.
-- ---------------------------------------------------------------------
create or replace function company_collaborator_summary(
  p_company_id uuid,
  p_start date
)
returns table (
  collaborator_id uuid,
  full_name text,
  email text,
  avatar_path text,
  seconds bigint,
  total bigint,
  done bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ti.collaborator_id,
    p.full_name,
    p.email,
    p.avatar_path,
    coalesce(sum(ti.total_seconds), 0) as seconds,
    count(*) as total,
    count(*) filter (where ti.status = 'finalizada') as done
  from task_instances ti
  left join profiles p on p.id = ti.collaborator_id
  where ti.company_id = p_company_id
    and (p_start is null or ti.task_date >= p_start)
  group by ti.collaborator_id, p.full_name, p.email, p.avatar_path
  order by seconds desc;
$$;

grant execute on function company_overview(uuid, date, date) to authenticated;
grant execute on function company_collaborator_summary(uuid, date) to authenticated;
