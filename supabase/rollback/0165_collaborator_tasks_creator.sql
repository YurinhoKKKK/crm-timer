-- =====================================================================
-- ROLLBACK da 0165 — volta ao estado pós-0164 (sem criador na lista/facets).
-- =====================================================================

drop function if exists public.collaborator_tasks_page(uuid, date, date, text, uuid, text, uuid, text, text, int, int);
create function public.collaborator_tasks_page(
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
  id uuid, title text, status task_status, due_at timestamptz, task_date date,
  finished_at timestamptz, total_seconds integer, company_id uuid, company_name text,
  type_key text, type_label text, only_by_work boolean,
  adjustment_count int, adjustments jsonb, total_count bigint
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
  v_from timestamptz := case when p_start is null then null else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_tasks_page: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  with rows as (
    select ti.id, ti.title, ti.status, ti.due_at, ti.task_date, ti.finished_at,
      ti.total_seconds, ti.company_id, c.name as company_name, ti.description,
      case when tt.category is not null then 'cat:' || tt.category::text
           when tt.template_type = 'listagem' then 'cat:listagem'
           else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_key,
      case when tt.category is not null then tt.category::text
           when tt.template_type = 'listagem' then 'Listagem'
           else coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_label,
      not task_in_period(ti.due_at, ti.status, p_start, p_end) as only_by_work
    from task_instances ti
    left join companies c on c.id = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and (task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (select 1 from time_entries te where te.task_id = ti.id
          and (v_from is null or te.started_at >= v_from) and (v_to is null or te.started_at < v_to)))
  ),
  filtered as (
    select r.* from rows r
    where (p_company is null or r.company_id = p_company)
      and (p_type is null or r.type_key = p_type)
      and (p_status is null or p_status = ''
        or (p_status in ('atrasada','atrasadas') and r.status in ('a_fazer','iniciada') and r.due_at < now())
        or (p_status in ('a_fazer','iniciada','finalizada','cancelada') and r.status::text = p_status))
      and (v_search = ''
        or lower(extensions.unaccent(coalesce(r.title,''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.company_name,''))) like '%' || v_search || '%'
        or lower(extensions.unaccent(coalesce(r.description,''))) like '%' || v_search || '%')
  ),
  ordered as (
    select f.*, count(*) over() as total_count from filtered f
    order by case when p_order = 'antigas' then f.due_at end asc nulls last,
      case when p_order = 'proximo' then abs(extract(epoch from (f.due_at - now()))) end asc nulls last,
      case when p_order not in ('antigas','proximo') then f.due_at end desc nulls last, f.id desc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select o.id, o.title, o.status, o.due_at, o.task_date, o.finished_at,
    o.total_seconds, o.company_id, o.company_name, o.type_key, o.type_label, o.only_by_work,
    coalesce(adj.cnt, 0), coalesce(adj.items, '[]'::jsonb), o.total_count
  from ordered o
  left join lateral (
    select count(*)::int as cnt,
      jsonb_agg(jsonb_build_object('oldSeconds', ta.old_seconds, 'newSeconds', ta.new_seconds,
        'reason', ta.reason, 'at', ta.created_at, 'by', coalesce(pr.full_name, pr.email, 'admin'))
        order by ta.created_at desc) as items
    from time_adjustments ta left join profiles pr on pr.id = ta.adjusted_by
    where ta.task_id = o.id
  ) adj on true
  order by case when p_order = 'antigas' then o.due_at end asc nulls last,
    case when p_order = 'proximo' then abs(extract(epoch from (o.due_at - now()))) end asc nulls last,
    case when p_order not in ('antigas','proximo') then o.due_at end desc nulls last, o.id desc;
end;
$$;
revoke execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) from public, anon;
grant  execute on function public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int) to authenticated;

create or replace function public.collaborator_task_facets(
  p_collaborator uuid, p_start date, p_end date
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_companies jsonb; v_types jsonb;
  v_from timestamptz := case when p_start is null then null else (p_start::timestamp at time zone 'America/Sao_Paulo') end;
  v_to   timestamptz := case when p_end is null then null else ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo') end;
begin
  if not (select is_admin()) then
    raise exception 'collaborator_task_facets: acesso restrito a administradores.' using errcode = '42501';
  end if;
  with rows as (
    select ti.company_id, c.name as company_name,
      case when tt.category is not null then 'cat:' || tt.category::text
           when tt.template_type = 'listagem' then 'cat:listagem'
           else 'title:' || coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_key,
      case when tt.category is not null then tt.category::text
           when tt.template_type = 'listagem' then 'Listagem'
           else coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_label
    from task_instances ti
    left join companies c on c.id = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and (task_in_period(ti.due_at, ti.status, p_start, p_end)
        or exists (select 1 from time_entries te where te.task_id = ti.id
          and (v_from is null or te.started_at >= v_from) and (v_to is null or te.started_at < v_to)))
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('id', t.company_id, 'name', t.company_name) order by t.company_name)
      from (select distinct company_id, company_name from rows) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('key', t.type_key, 'label', t.type_label) order by (t.type_key like 'title:%'), t.type_label)
      from (select distinct type_key, type_label from rows) t), '[]'::jsonb)
  into v_companies, v_types;
  return jsonb_build_object('companies', v_companies, 'types', v_types);
end;
$$;
revoke execute on function public.collaborator_task_facets(uuid, date, date) from public, anon;
grant  execute on function public.collaborator_task_facets(uuid, date, date) to authenticated;
