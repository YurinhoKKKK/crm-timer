-- =====================================================================
-- ROLLBACK da 0164 — volta ao estado pós-0163.
--   · admin_adjust_time volta à versão antiga (reconciliação em now(),
--     entradas negativas na redução);
--   · remove time_entries.is_manual;
--   · collaborator_tasks_page/facets voltam SEM o critério "trabalhada" e
--     sem a coluna only_by_work.
-- =====================================================================

-- 1) admin_adjust_time — versão pré-0164 (migrations 0012 + 0038).
create or replace function admin_adjust_time(
  p_task uuid,
  p_new_seconds integer,
  p_reason text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_old integer;
  v_collab uuid;
  v_sum integer;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if p_new_seconds is null or p_new_seconds < 0 then
    raise exception 'tempo invalido';
  end if;

  select total_seconds, collaborator_id into v_old, v_collab
    from task_instances where id = p_task;
  if not found then
    raise exception 'tarefa nao encontrada';
  end if;

  update time_entries
    set ended_at = now(),
        seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
    where task_id = p_task and ended_at is null;

  select coalesce(sum(seconds), 0) into v_sum from time_entries
    where task_id = p_task and seconds is not null;

  if p_new_seconds <> v_sum then
    insert into time_entries (task_id, collaborator_id, started_at, ended_at, seconds)
      values (p_task, v_collab, now(), now(), p_new_seconds - v_sum);
  end if;

  update task_instances set total_seconds = p_new_seconds where id = p_task;

  insert into time_adjustments (task_id, adjusted_by, old_seconds, new_seconds, reason)
    values (p_task, v_admin, v_old, p_new_seconds,
            nullif(btrim(coalesce(p_reason, '')), ''));

  return p_new_seconds;
end;
$$;

grant execute on function admin_adjust_time(uuid, integer, text) to authenticated;

-- 2) Remove a coluna is_manual.
alter table time_entries drop column if exists is_manual;

-- 3) collaborator_tasks_page — versão 0163 (sem only_by_work / sem "trabalhada").
drop function if exists public.collaborator_tasks_page(uuid, date, date, text, uuid, text, text, text, int, int);
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
  type_key text, type_label text, adjustment_count int, adjustments jsonb, total_count bigint
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_search text := lower(extensions.unaccent(coalesce(nullif(btrim(p_search), ''), '')));
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
           else coalesce(nullif(btrim(tt.title), ''), ti.title) end as type_label
    from task_instances ti
    left join companies c on c.id = ti.company_id
    left join task_templates tt on tt.id = ti.template_id
    where ti.collaborator_id = p_collaborator
      and task_in_period(ti.due_at, ti.status, p_start, p_end)
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
    o.total_seconds, o.company_id, o.company_name, o.type_key, o.type_label,
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

-- 4) collaborator_task_facets — versão 0163 (sem "trabalhada").
create or replace function public.collaborator_task_facets(
  p_collaborator uuid, p_start date, p_end date
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_companies jsonb; v_types jsonb;
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
      and task_in_period(ti.due_at, ti.status, p_start, p_end)
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
