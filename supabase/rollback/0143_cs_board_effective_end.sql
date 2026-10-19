-- =====================================================================
-- Reversão de 0143_cs_board_effective_end
-- =====================================================================
-- Restaura cs_board sem as colunas de pausa (estado anterior; anon continua como
-- estava antes — o grant a authenticated é reafirmado).
-- =====================================================================
drop function if exists public.cs_board();

create function public.cs_board()
returns table(
  id uuid, name text, group_id uuid, started_on text, monthly_value text,
  project_value text, installments integer, months_total integer, period_days integer,
  nps_status text, meeting_on text, responsibles jsonb, cs_note_count integer
)
language plpgsql
set search_path to 'public'
as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Sucesso do Cliente.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  with resp as (
    select company_id, consultant_id as user_id, true as is_cons, false as is_colab from company_consultants
    union all
    select company_id, collaborator_id as user_id, false, true from company_collaborators
  ),
  resp_roles as (
    select r.company_id, r.user_id, bool_or(r.is_cons) as is_cons, bool_or(r.is_colab) as is_colab
    from resp r group by r.company_id, r.user_id
  ),
  resp_json as (
    select rr.company_id,
      jsonb_agg(
        jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email),
          'role', case when rr.is_cons and rr.is_colab then 'ambos' when rr.is_cons then 'consultor' else 'colaborador' end,
          'status', pn.status)
        order by (case when rr.is_cons then 0 else 1 end), coalesce(nullif(p.full_name, ''), p.email)
      ) as items
    from resp_roles rr join profiles p on p.id = rr.user_id
    left join cs_person_nps pn on pn.company_id = rr.company_id and pn.user_id = rr.user_id
    group by rr.company_id
  ),
  notes as (select company_id, count(*)::int as n from cs_notes group by company_id)
  select c.id, c.name, c.group_id,
    to_char(d.started_on, 'YYYY-MM-DD'),
    case when v.project_value is not null and v.installments is not null and v.installments <> 0 then round(v.project_value / v.installments, 2)::text else null end,
    v.project_value::text, v.installments,
    cd.months_total, cd.period_days,
    s.nps_status::text, to_char(s.meeting_on, 'YYYY-MM-DD'),
    coalesce(rj.items, '[]'::jsonb), coalesce(csn.n, 0)
  from companies c
  left join company_details d on d.company_id = c.id
  left join lateral contract_duration(d.started_on, d.ends_on) cd on true
  left join company_contract_values v on v.company_id = c.id
  left join cs_company_status s on s.company_id = c.id
  left join resp_json rj on rj.company_id = c.id
  left join notes csn on csn.company_id = c.id
  order by c.name;
end;
$fn$;

grant execute on function public.cs_board() to authenticated;

delete from supabase_migrations.schema_migrations
 where name = '0143_cs_board_effective_end';
