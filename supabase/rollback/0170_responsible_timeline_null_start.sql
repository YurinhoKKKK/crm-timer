-- =====================================================================
-- ROLLBACK 0170_responsible_timeline_null_start
-- =====================================================================
-- Restaura a RPC company_responsible_timeline da 0168 (array cru) e remove o
-- helper responsible_tracking_since(). Nota: o rollback da RPC assume que a
-- coluna start_date volta a ser NOT NULL (rollback da 0169) — enquanto houver
-- períodos reconstruídos com start_date null, a UI antiga mostrará "hoje".
-- =====================================================================

create or replace function public.company_responsible_timeline(p_company uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions'
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', rp.id, 'personId', rp.person_id, 'role', rp.role,
      'name', coalesce(dp.name, '(desconhecido)'), 'avatar', dp.avatar_path,
      'startDate', rp.start_date, 'endDate', rp.end_date, 'source', rp.source
    ) order by rp.role, rp.start_date desc, rp.end_date desc nulls first),
    '[]'::jsonb)
  from company_responsible_periods rp
  left join lateral (select name, avatar_path from display_profiles(array[rp.person_id])) dp on true
  where rp.company_id = p_company;
$$;

revoke all on function public.company_responsible_timeline(uuid) from public, anon;
grant execute on function public.company_responsible_timeline(uuid) to authenticated;

drop function if exists public.responsible_tracking_since();
