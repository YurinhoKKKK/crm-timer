-- =====================================================================
-- 0108 — Quadro "Tráfego" (Fatia 1): grupos próprios + visão só-leitura
-- =====================================================================
-- Como o quadro CS, o Tráfego é uma VISÃO sobre as MESMAS empresas do quadro de
-- Empresas (nada é copiado), mas com GRUPOS PRÓPRIOS (traffic_groups) e sua
-- própria correspondência com os grupos de Empresas.
--
-- Entra no quadro toda empresa com 'trafego' em company_contracted_channels (ao
-- vivo). O "modo de movimentação" é CALCULADO (nunca guardado): sincronizada com
-- Empresas quando também tem marketplace (mercado_livre/shopee/amazon); senão,
-- manual.
--
-- Esta fatia cria o modelo + 2 RPCs e NÃO abre leitura para não-admin (fatia 4).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Grupos do Tráfego (tabela PRÓPRIA). 6 linhas semeadas na ordem pedida;
--    a cor de cada uma é COPIADA (valor, não referência) do grupo de MESMO NOME
--    em company_groups no momento da migration.
-- ---------------------------------------------------------------------
create table traffic_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#3145FF',
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

alter table traffic_groups enable row level security;

-- RLS: select e escrita só admin (a fatia 4 abrirá leitura para o gestor).
create policy tg_select on traffic_groups
  for select using ((select is_admin()));
create policy tg_write on traffic_groups
  for all using ((select is_admin())) with check ((select is_admin()));

insert into traffic_groups (name, color, position) values
  ('On Boarding',          coalesce((select color from company_groups where name = 'On Boarding'          limit 1), '#3145FF'), 1),
  ('Ativos',               coalesce((select color from company_groups where name = 'Ativos'               limit 1), '#22C55E'), 2),
  ('Aguardando Renovação', coalesce((select color from company_groups where name = 'Aguardando Renovação' limit 1), '#F59E0B'), 3),
  ('Pausados',             coalesce((select color from company_groups where name = 'Pausados'             limit 1), '#F59E0B'), 4),
  ('Projetos Finalizados', coalesce((select color from company_groups where name = 'Projetos Finalizados' limit 1), '#64748B'), 5),
  ('Cancelados',           coalesce((select color from company_groups where name = 'Cancelados'           limit 1), '#EF4444'), 6);

-- ---------------------------------------------------------------------
-- 2) Correspondência Empresas -> Tráfego em company_groups.traffic_group_id.
--    FK ON DELETE SET NULL (apagar o grupo do Tráfego devolve o de Empresas a
--    "sem correspondência"). Semeado POR ID de company_groups (IDs conferidos no
--    banco); o lado do Tráfego é referenciado pelo nome recém-semeado.
--      On Boarding -> On Boarding
--      Ativos, Ema, Potencializa Amazon -> Ativos
--      Aguardando Renovação -> Aguardando Renovação
--      Pausados -> Pausados ; Projetos Finalizados -> Projetos Finalizados
--      Cancelados -> Cancelados
-- ---------------------------------------------------------------------
alter table company_groups
  add column traffic_group_id uuid references traffic_groups(id) on delete set null;

update company_groups set traffic_group_id = (select id from traffic_groups where name = 'On Boarding')
 where id = '141773e9-4033-4ac5-a7b2-85ececb5ea5b';
update company_groups set traffic_group_id = (select id from traffic_groups where name = 'Ativos')
 where id in (
   '2ce27022-3014-4666-b885-c6f9b0ec4aeb',  -- Ativos
   'e9b3598b-4390-4148-97ac-a6a74d5b0070',  -- Ema
   'f2cd1ee0-cb9f-4510-85ca-fe4c789a9c63'   -- Potencializa Amazon
 );
update company_groups set traffic_group_id = (select id from traffic_groups where name = 'Aguardando Renovação')
 where id = '2f5762e7-df86-4b66-9525-71275d3a4ffe';
update company_groups set traffic_group_id = (select id from traffic_groups where name = 'Pausados')
 where id = 'f0ed1cdc-12ae-4c6c-8d35-26eb950b0705';
update company_groups set traffic_group_id = (select id from traffic_groups where name = 'Projetos Finalizados')
 where id = '947b8de9-0f85-4eb2-b789-c2b648978d0f';
update company_groups set traffic_group_id = (select id from traffic_groups where name = 'Cancelados')
 where id = '5d1ff3fa-9802-40a5-85b7-166e3b25b167';

-- ---------------------------------------------------------------------
-- 3) Duração do contrato — MESMO cálculo do "Tempo de Projeto" do CS, extraído
--    para uma função SQL compartilhada (usada por cs_board e traffic_board).
--    age(ends, started): meses = anos*12 + meses; dias = componente de dias.
--    Qualquer data nula -> (null, null), idêntico ao CS de antes.
-- ---------------------------------------------------------------------
create or replace function contract_duration(p_started date, p_ends date)
returns table(months_total integer, period_days integer)
language sql
immutable
set search_path = public
as $$
  select
    case when p_started is not null and p_ends is not null
         then (extract(year  from age(p_ends, p_started)) * 12
             + extract(month from age(p_ends, p_started)))::int
         else null end,
    case when p_started is not null and p_ends is not null
         then extract(day from age(p_ends, p_started))::int
         else null end;
$$;

grant execute on function contract_duration(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4) cs_board() — IDÊNTICA à anterior; só troca as duas expressões inline de
--    tempo pela função compartilhada (via lateral). Retorno inalterado.
-- ---------------------------------------------------------------------
create or replace function cs_board()
returns table(id uuid, name text, group_id uuid, started_on text, monthly_value text, project_value text, installments integer, months_total integer, period_days integer, nps_status text, meeting_on text, responsibles jsonb, cs_note_count integer)
language plpgsql
set search_path to 'public'
as $function$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Sucesso do Cliente.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with resp as (
    select company_id, consultant_id as user_id, true as is_cons, false as is_colab from company_consultants
    union all
    select company_id, collaborator_id as user_id, false, true from company_collaborators
  ),
  resp_roles as (
    select r.company_id, r.user_id, bool_or(r.is_cons) as is_cons, bool_or(r.is_colab) as is_colab from resp r group by r.company_id, r.user_id
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
$function$;

-- ---------------------------------------------------------------------
-- 5) traffic_board() — uma linha por empresa COM 'trafego'. SECURITY INVOKER,
--    admin-only por dentro. Devolve o group_id de Empresas (para
--    resolveCompanyGroupId), o modo calculado (synced) e a duração do contrato.
--    A correspondência de grupos é lida pela página (company_groups.
--    traffic_group_id), tabela minúscula, nunca consulta que trunque.
-- ---------------------------------------------------------------------
create or replace function traffic_board()
returns table(
  id uuid,
  name text,
  group_id uuid,
  synced boolean,
  months_total integer,
  period_days integer
)
language plpgsql
set search_path to 'public'
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select
    c.id,
    c.name,
    c.group_id,
    exists (
      select 1 from company_contracted_channels x
       where x.company_id = c.id
         and x.channel in ('mercado_livre', 'shopee', 'amazon')
    ) as synced,
    cd.months_total,
    cd.period_days
  from companies c
  left join company_details d on d.company_id = c.id
  left join lateral contract_duration(d.started_on, d.ends_on) cd on true
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id and cc.channel = 'trafego'
  )
  order by c.name;
end;
$$;

grant execute on function traffic_board() to authenticated;
