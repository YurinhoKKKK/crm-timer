-- =====================================================================
-- 0154 — company_responsibles: responsáveis (consultores + colaboradores) por
-- empresa, para os balões dos painéis "Minhas empresas" (consultor e colaborador)
-- =====================================================================
-- Os painéis listam a carteira da pessoa e precisam mostrar consultores E
-- colaboradores responsáveis de cada empresa. A RLS direta não serve: cc_select
-- (company_consultants) só deixa o consultor ver a PRÓPRIA linha e NÃO deixa o
-- colaborador ver consultor nenhum. Esta RPC SECURITY DEFINER devolve os dois
-- grupos SOMENTE para empresas que o chamador ALCANÇA (admin, ou consultor-da,
-- ou colaborador-da) — leitura agregada (um array de ids), nunca uma por empresa.
-- Expansão de acesso APROVADA pelo usuário (colaborador passa a ver consultores
-- das empresas que já alcança). Não altera nenhuma policy de tabela.
-- Convenção [[funcao-nova-revoke-anon]].
-- =====================================================================

create or replace function company_responsibles(p_company_ids uuid[])
returns table(company_id uuid, consultants jsonb, collaborators jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with reachable as (
    select c.id
      from companies c
     where c.id = any(p_company_ids)
       and ((select is_admin())
         or c.id in (select my_consultant_companies())
         or c.id in (select my_collaborator_companies()))
  ),
  cons as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.consultant_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_consultants cc
      join reachable r on r.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.consultant_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  ),
  colabs as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.collaborator_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_collaborators cc
      join reachable r on r.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.collaborator_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  )
  select r.id, coalesce(cons.list, '[]'::jsonb), coalesce(colabs.list, '[]'::jsonb)
    from reachable r
    left join cons   on cons.company_id = r.id
    left join colabs on colabs.company_id = r.id;
end;
$$;
revoke execute on function company_responsibles(uuid[]) from public, anon;
grant  execute on function company_responsibles(uuid[]) to authenticated;
