-- =====================================================================
-- 0163 — Detalhe do colaborador: lista de tarefas PAGINADA NO BANCO
-- =====================================================================
-- Problema: a lista "Tarefas com prazo no período + atrasadas em aberto" do
-- detalhe do colaborador (src/app/admin/colaboradores/[id]) carregava no máximo
-- 300 linhas (tasks_in_period, teto de escala) ordenadas por due_at ASC. O corte
-- caía nas tarefas MAIS RECENTES, e a busca/filtros agiam só sobre as 300. As
-- contagens do cabeçalho (task_status_counts) já eram imunes ao teto, mas a lista
-- não batia com elas.
--
-- Solução: três RPCs DEFINER (gate is_admin()), reusando o MESMO critério de
-- período das contagens — a função `task_in_period` (0098), por PRAZO (due_at em
-- BRT como data): prazo dentro de [start,end] em qualquer status OU aberta com
-- prazo antes do início (atrasada carregada).
--
--   1) collaborator_tasks_page  — lista paginada (limit/offset) + total_count,
--      com busca livre (título, nome/numero da empresa no próprio nome, descrição;
--      sem acento, sem caixa), filtros (status/empresa/tipo), ordenação, "tipo"
--      calculado (categoria | Listagem | título do modelo padrão) e os ajustes de
--      tempo (time_adjustments) agregados SÓ das linhas da página (lateral após o
--      limit).
--   2) collaborator_task_facets — empresas e tipos DISTINTOS do colaborador no
--      período (para os filtros não dependerem da página carregada). jsonb.
--   3) collaborator_pending_tasks — todas as a_fazer/iniciada do colaborador no
--      período, sem teto (seção "Atrasadas e pendentes": contador e itens batem).
--
-- Busca sem acento: extensions.unaccent (já instalada) — qualificada pelo schema
-- porque a função roda com search_path 'public'.
--
-- Convenção (funcao-nova-revoke-anon): REVOKE de public/anon + GRANT authenticated.
-- Aditiva: nada é alterado nas tabelas nem nas RPCs existentes.
--
-- ROLLBACK (completo — puramente aditiva): ver supabase/rollback/0163_*.sql
-- =====================================================================

-- =====================================================================
-- 1) collaborator_tasks_page — lista paginada no banco
-- =====================================================================
-- p_status aceita 'a_fazer'|'iniciada'|'finalizada'|'cancelada' e o recorte
-- derivado 'atrasada'/'atrasadas' (aberta + prazo vencido). null/'' = todos.
-- p_order: 'recentes' (default, prazo desc), 'antigas' (prazo asc), 'proximo'
-- (mais perto de agora, |due_at - now| asc). Empate estável por id para a
-- paginação por offset não repetir/pular linhas.
create or replace function public.collaborator_tasks_page(
  p_collaborator uuid,
  p_start        date,
  p_end          date,
  p_status       text default null,
  p_company      uuid default null,
  p_type         text default null,
  p_search       text default null,
  p_order        text default 'recentes',
  p_limit        int  default 50,
  p_offset       int  default 0
)
returns table(
  id uuid,
  title text,
  status task_status,
  due_at timestamptz,
  task_date date,
  finished_at timestamptz,
  total_seconds integer,
  company_id uuid,
  company_name text,
  type_key text,
  type_label text,
  adjustment_count int,
  adjustments jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
begin
  if not (select is_admin()) then
    raise exception 'collaborator_tasks_page: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      ti.id,
      ti.title,
      ti.status,
      ti.due_at,
      ti.task_date,
      ti.finished_at,
      ti.total_seconds,
      ti.company_id,
      c.name as company_name,
      ti.description,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and task_in_period(ti.due_at, ti.status, p_start, p_end)
  ),
  filtered as (
    select r.*
    from rows r
    where (p_company is null or r.company_id = p_company)
      and (p_type is null or r.type_key = p_type)
      and (
        p_status is null or p_status = ''
        or (p_status in ('atrasada', 'atrasadas')
            and r.status in ('a_fazer', 'iniciada') and r.due_at < now())
        or (p_status in ('a_fazer', 'iniciada', 'finalizada', 'cancelada')
            and r.status::text = p_status)
      )
      and (
        v_search = ''
        or lower(extensions.unaccent(coalesce(r.title, '')))        like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.company_name, ''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.description, '')))  like '%' || v_search || '%'
      )
  ),
  ordered as (
    select f.*, count(*) over() as total_count
    from filtered f
    order by
      case when p_order = 'antigas' then f.due_at end asc  nulls last,
      case when p_order = 'proximo'
           then abs(extract(epoch from (f.due_at - now()))) end asc nulls last,
      case when p_order not in ('antigas', 'proximo') then f.due_at end desc nulls last,
      f.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select
    o.id, o.title, o.status, o.due_at, o.task_date, o.finished_at,
    o.total_seconds, o.company_id, o.company_name, o.type_key, o.type_label,
    coalesce(adj.cnt, 0) as adjustment_count,
    coalesce(adj.items, '[]'::jsonb) as adjustments,
    o.total_count
  from ordered o
  left join lateral (
    select
      count(*)::int as cnt,
      jsonb_agg(
        jsonb_build_object(
          'oldSeconds', ta.old_seconds,
          'newSeconds', ta.new_seconds,
          'reason',     ta.reason,
          'at',         ta.created_at,
          'by',         coalesce(pr.full_name, pr.email, 'admin')
        ) order by ta.created_at desc
      ) as items
    from time_adjustments ta
    left join profiles pr on pr.id = ta.adjusted_by
    where ta.task_id = o.id
  ) adj on true
  order by
    case when p_order = 'antigas' then o.due_at end asc  nulls last,
    case when p_order = 'proximo'
         then abs(extract(epoch from (o.due_at - now()))) end asc nulls last,
    case when p_order not in ('antigas', 'proximo') then o.due_at end desc nulls last,
    o.id desc;
end;
$$;

comment on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) is
  'Lista paginada no banco das tarefas de um colaborador num período (MESMO critério de task_in_period). Busca sem acento (título, nome da empresa, descrição), filtros status/empresa/tipo, ordenação e ajustes de tempo agregados só da página. DEFINER + gate is_admin().';

revoke execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) from public, anon;
grant  execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) to authenticated;

-- =====================================================================
-- 2) collaborator_task_facets — empresas e tipos para os filtros
-- =====================================================================
-- Distintos sobre TODAS as tarefas do colaborador no período (não derivado da
-- página). Empresas ordenadas por nome; tipos com categorias/Listagem antes dos
-- títulos de modelo padrão, cada grupo em ordem alfabética do rótulo.
create or replace function public.collaborator_task_facets(
  p_collaborator uuid,
  p_start        date,
  p_end          date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_companies jsonb;
  v_types jsonb;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_task_facets: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  with rows as (
    select
      ti.company_id,
      c.name as company_name,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and task_in_period(ti.due_at, ti.status, p_start, p_end)
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.company_id, 'name', t.company_name)
                       order by t.company_name)
      from (select distinct company_id, company_name from rows) t
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('key', t.type_key, 'label', t.type_label)
                       order by (t.type_key like 'title:%'), t.type_label)
      from (select distinct type_key, type_label from rows) t
    ), '[]'::jsonb)
  into v_companies, v_types;

  return jsonb_build_object('companies', v_companies, 'types', v_types);
end;
$$;

comment on function public.collaborator_task_facets(uuid, date, date) is
  'Empresas e tipos distintos das tarefas de um colaborador num período, para os filtros do detalhe (não derivados da página). DEFINER + gate is_admin().';

revoke execute on function public.collaborator_task_facets(uuid, date, date) from public, anon;
grant  execute on function public.collaborator_task_facets(uuid, date, date) to authenticated;

-- =====================================================================
-- 3) collaborator_pending_tasks — atrasadas e pendentes (completa)
-- =====================================================================
-- Todas as a_fazer/iniciada do colaborador no período, SEM teto — o contador e os
-- itens da seção "Atrasadas e pendentes" têm de bater. Ordena atrasadas primeiro,
-- depois por prazo asc (prazo mais próximo no topo).
create or replace function public.collaborator_pending_tasks(
  p_collaborator uuid,
  p_start        date,
  p_end          date
)
returns table(
  id uuid,
  title text,
  status task_status,
  due_at timestamptz,
  company_name text,
  overdue boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (select is_admin()) then
    raise exception 'collaborator_pending_tasks: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  select
    ti.id, ti.title, ti.status, ti.due_at,
    c.name as company_name,
    (ti.due_at is not null and ti.due_at < now()) as overdue
  from task_instances ti
  left join companies c on c.id = ti.company_id
  where ti.collaborator_id = p_collaborator
    and ti.status in ('a_fazer', 'iniciada')
    and task_in_period(ti.due_at, ti.status, p_start, p_end)
  order by
    (ti.due_at is not null and ti.due_at < now()) desc,  -- atrasadas primeiro
    ti.due_at asc nulls last,
    ti.id;
end;
$$;

comment on function public.collaborator_pending_tasks(uuid, date, date) is
  'Todas as tarefas a_fazer/iniciada de um colaborador num período, sem teto (seção Atrasadas e pendentes do detalhe). DEFINER + gate is_admin().';

revoke execute on function public.collaborator_pending_tasks(uuid, date, date) from public, anon;
grant  execute on function public.collaborator_pending_tasks(uuid, date, date) to authenticated;
