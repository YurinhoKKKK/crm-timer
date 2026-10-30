-- =====================================================================
-- 0165 — Detalhe do colaborador: CRIADOR da tarefa (exibir + filtrar + buscar)
-- =====================================================================
-- A lista de tarefas do detalhe do colaborador (collaborator_tasks_page /
-- collaborator_task_facets, 0163+) passa a conhecer o CRIADOR da tarefa, com a
-- MESMA fonte e regras do describeInstanceCreator/CreatorMeta do painel de
-- detalhe: o criador é task_templates.created_by; a origem (tarefa padrão /
-- recorrência) sai de standard_task_id e da distância entre o created_at do
-- template e o da ocorrência (margem de 5 min). Sem coluna nova.
--
--   · collaborator_tasks_page devolve created_by + nome + avatar_path do criador
--     (só full_name e avatar, via profiles — nunca e-mail, igual display_profiles),
--     mais from_standard / system_generated / has_origin para a UI montar o rótulo.
--     Ganha o filtro p_creator e a busca livre passa a casar o nome do criador.
--   · collaborator_task_facets passa a devolver também `creators` (distintos do
--     período, com foto e nome) para o filtro "Todos os criadores".
--
-- collaborator_tasks_page é RECRIADA (DROP+CREATE) porque muda parâmetros e
-- retorno; collaborator_task_facets é CREATE OR REPLACE (retorno jsonb mantém a
-- forma). DEFINER + gate is_admin(); REVOKE public/anon.
--
-- ROLLBACK (completo — volta ao estado pós-0164): supabase/rollback/0165_*.sql
-- =====================================================================

drop function if exists public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int);
create function public.collaborator_tasks_page(
  p_collaborator uuid,
  p_start        date,
  p_end          date,
  p_status       text default null,
  p_company      uuid default null,
  p_type         text default null,
  p_creator      uuid default null,
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
  only_by_work boolean,
  created_by uuid,
  creator_name text,
  creator_avatar_path text,
  from_standard boolean,
  system_generated boolean,
  has_origin boolean,
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
  v_from timestamptz := case when p_start is null then null
                             else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null
                             else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_tasks_page: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      ti.id, ti.title, ti.status, ti.due_at, ti.task_date, ti.finished_at,
      ti.total_seconds, ti.company_id, c.name as company_name, ti.description,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label,
      not task_in_period(ti.due_at, ti.status, p_start, p_end) as only_by_work,
      tt.created_by as created_by,
      nullif(btrim(p2.full_name), '') as creator_name,
      p2.avatar_path as creator_avatar_path,
      (tt.standard_task_id is not null) as from_standard,
      (tt.created_at is not null and ti.created_at is not null
         and ti.created_at - tt.created_at > interval '5 minutes') as system_generated,
      (tt.id is not null) as has_origin
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    left join profiles       p2 on p2.id = tt.created_by
    where ti.collaborator_id = p_collaborator
      and (
        task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (
          select 1 from time_entries te
          where te.task_id = ti.id
            and (v_from is null or te.started_at >= v_from)
            and (v_to   is null or te.started_at <  v_to)
        )
      )
  ),
  filtered as (
    select r.*
    from rows r
    where (p_company is null or r.company_id = p_company)
      and (p_type is null or r.type_key = p_type)
      and (p_creator is null or r.created_by = p_creator)
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
        or lower(extensions.unaccent(coalesce(r.creator_name, '')))  like '%' || v_search || '%'
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
    o.only_by_work,
    o.created_by, o.creator_name, o.creator_avatar_path,
    o.from_standard, o.system_generated, o.has_origin,
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

comment on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, uuid, text, text, int, int) is
  'Lista paginada no banco das tarefas de um colaborador num período (prazo OU trabalhada OU atrasada). Devolve o CRIADOR (task_templates.created_by: nome+avatar, from_standard/system_generated/has_origin). Filtros status/empresa/tipo/criador, busca sem acento (inclui nome do criador), ordenação e ajustes da página. DEFINER + gate is_admin().';

revoke execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, uuid, text, text, int, int) from public, anon;
grant  execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, uuid, text, text, int, int) to authenticated;

-- Facets: + creators (distintos do período, com foto e nome).
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
  v_creators jsonb;
  v_from timestamptz := case when p_start is null then null
                             else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null
                             else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_task_facets: acesso restrito a administradores.'
      using errcode = '42501';
  end if;

  with rows as (
    select
      ti.company_id, c.name as company_name,
      case
        when tt.category is not null then 'cat:' || tt.category::text
        when tt.template_type = 'listagem' then 'cat:listagem'
        else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_key,
      case
        when tt.category is not null then tt.category::text
        when tt.template_type = 'listagem' then 'Listagem'
        else coalesce(nullif(btrim(tt.title), ''), ti.title)
      end as type_label,
      tt.created_by as creator_id,
      nullif(btrim(p2.full_name), '') as creator_name,
      p2.avatar_path as creator_avatar_path
    from task_instances ti
    left join companies      c  on c.id  = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    left join profiles       p2 on p2.id = tt.created_by
    where ti.collaborator_id = p_collaborator
      and (
        task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (
          select 1 from time_entries te
          where te.task_id = ti.id
            and (v_from is null or te.started_at >= v_from)
            and (v_to   is null or te.started_at <  v_to)
        )
      )
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
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.creator_id, 'name', t.creator_name, 'avatar_path', t.creator_avatar_path)
                       order by t.creator_name)
      from (select distinct creator_id, creator_name, creator_avatar_path from rows
            where creator_id is not null and creator_name is not null) t
    ), '[]'::jsonb)
  into v_companies, v_types, v_creators;

  return jsonb_build_object('companies', v_companies, 'types', v_types, 'creators', v_creators);
end;
$$;

revoke execute on function public.collaborator_task_facets(uuid, date, date) from public, anon;
grant  execute on function public.collaborator_task_facets(uuid, date, date) to authenticated;
