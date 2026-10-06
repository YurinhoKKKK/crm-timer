-- Quadro "Sucesso do Cliente" (CS) — FATIA 1: leitura.
--
-- UMA RPC devolve UMA linha por empresa (nunca montar o quadro no JS a partir de
-- selects que truncam em 1000). Lê AO VIVO as mesmas tabelas do quadro Empresas
-- (companies, company_groups via group_id, company_consultants,
-- company_collaborators, company_details, company_contract_values) — nada é
-- copiado.
--
-- Acesso: admin-only. A RPC é SECURITY INVOKER (a RLS de cada tabela ainda vale)
-- e, como defesa dupla, começa recusando quem não é admin.
--
-- Campos CALCULADOS, nunca guardados:
--  · Valor Mensal = round(project_value / installments, 2) — em numeric, devolvido
--    como TEXTO (o front só formata em BRL). Nulo se faltar valor/parcelas ou se
--    parcelas = 0.
--  · Tempo de Projeto = age(ends_on, started_on): meses = anos*12 + meses, e dias.
--    Nulo se faltar início ou fim.
--  · Data de Entrada = company_details.started_on, devolvida como texto AAAA-MM-DD
--    (o front exibe DD/MM/AAAA sem objeto Date, sem fuso).

create or replace function public.cs_board()
returns table (
  id uuid,
  name text,
  group_id uuid,
  started_on text,
  monthly_value text,
  project_value text,
  installments int,
  months_total int,
  period_days int,
  responsibles jsonb
)
language plpgsql
security invoker
set search_path to 'public'
as $fn$
begin
  -- Defesa dupla (além da RLS/rota): só admin lê o quadro.
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Sucesso do Cliente.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with consultores as (
    select cc.company_id,
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'name', coalesce(nullif(p.full_name, ''), p.email),
               'role', 'consultor'
             )
             order by coalesce(nullif(p.full_name, ''), p.email)
           ) as items
    from company_consultants cc
    join profiles p on p.id = cc.consultant_id
    group by cc.company_id
  ),
  colaboradores as (
    select cl.company_id,
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'name', coalesce(nullif(p.full_name, ''), p.email),
               'role', 'colaborador'
             )
             order by coalesce(nullif(p.full_name, ''), p.email)
           ) as items
    from company_collaborators cl
    join profiles p on p.id = cl.collaborator_id
    group by cl.company_id
  )
  select
    c.id,
    c.name,
    c.group_id,
    to_char(d.started_on, 'YYYY-MM-DD') as started_on,
    case
      when v.project_value is not null
       and v.installments is not null
       and v.installments <> 0
      then round(v.project_value / v.installments, 2)::text
      else null
    end as monthly_value,
    v.project_value::text as project_value,
    v.installments as installments,
    case
      when d.started_on is not null and d.ends_on is not null
      then (extract(year from age(d.ends_on, d.started_on)) * 12
            + extract(month from age(d.ends_on, d.started_on)))::int
      else null
    end as months_total,
    case
      when d.started_on is not null and d.ends_on is not null
      then extract(day from age(d.ends_on, d.started_on))::int
      else null
    end as period_days,
    -- Consultores primeiro, depois colaboradores (cada papel já ordenado por nome).
    coalesce(con.items, '[]'::jsonb) || coalesce(col.items, '[]'::jsonb) as responsibles
  from companies c
  left join company_details d on d.company_id = c.id
  left join company_contract_values v on v.company_id = c.id
  left join consultores con on con.company_id = c.id
  left join colaboradores col on col.company_id = c.id
  order by c.name;
end;
$fn$;

grant execute on function public.cs_board() to authenticated;
