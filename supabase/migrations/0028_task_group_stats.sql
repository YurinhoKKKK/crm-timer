-- =====================================================================
-- Agrupamento nas listas de tarefa — agregado por template
-- =====================================================================
-- As tarefas diárias acumulam uma instância por dia; as listas agrupam as
-- ocorrências da mesma tarefa (mesmo template) numa linha expansível. As
-- CONTAGENS do cabeçalho do grupo ("247 ocorrências · 3 atrasadas") vêm
-- desta função — agregada no banco, sem carregar as instâncias no servidor.
--
-- SECURITY INVOKER de propósito (mesmo padrão da 0016): a RLS de
-- task_instances (ti_select) escopa o que cada cargo enxerga. Filtros
-- opcionais por empresa, responsável e período (task_date >= p_start).
-- Templates com uma única ocorrência ficam de fora (não agrupam).
-- O índice único (template_id, task_date) já cobre o group by.
-- =====================================================================

create or replace function task_group_stats(
  p_company_id uuid default null,
  p_collaborator_id uuid default null,
  p_start date default null
)
returns table (
  template_id uuid,
  total bigint,
  finalizadas bigint,
  canceladas bigint,
  abertas bigint,
  atrasadas bigint,
  seconds bigint,
  first_date date,
  last_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ti.template_id,
    count(*)::bigint                                             as total,
    count(*) filter (where ti.status = 'finalizada')             as finalizadas,
    count(*) filter (where ti.status = 'cancelada')              as canceladas,
    count(*) filter (where ti.status in ('a_fazer', 'iniciada')) as abertas,
    count(*) filter (
      where ti.status in ('a_fazer', 'iniciada') and ti.due_at < now()
    )                                                            as atrasadas,
    coalesce(sum(ti.total_seconds), 0)::bigint                   as seconds,
    min(ti.task_date)                                            as first_date,
    max(ti.task_date)                                            as last_date
  from task_instances ti
  where ti.template_id is not null
    and (p_company_id is null or ti.company_id = p_company_id)
    and (p_collaborator_id is null or ti.collaborator_id = p_collaborator_id)
    and (p_start is null or ti.task_date >= p_start)
  group by ti.template_id
  having count(*) > 1;
$$;
