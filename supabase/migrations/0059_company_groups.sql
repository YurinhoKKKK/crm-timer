-- =====================================================================
-- Grupos de empresas (tela de empresas do admin) — no espírito dos grupos do
-- Monday: seções coloridas com empresas dentro. Grupo é GLOBAL (não por usuário)
-- e representa ESTADO DO CONTRATO (Ativos, Pausados, Cancelados, B.O, Aguardando
-- Renovação) — mas o sistema não cria nenhum grupo padrão nem faz backfill: toda
-- empresa nasce SEM grupo (group_id null = balde "Sem grupo").
--
-- UM grupo por empresa hoje (companies.group_id). PORTA ABERTA para M:N no
-- futuro sem perda de dado: a resolução "empresa -> grupo" fica centralizada em
-- UM helper (src/lib/company-groups.ts); se um dia surgir a necessidade, cria-se
-- company_group_members alimentada a partir do group_id atual.
--
-- SEGURANÇA: tudo admin-only. Consultor e colaborador não acessam a aba de
-- empresas, então não há motivo para expor grupos a eles (decisão reversível:
-- para expor o rótulo a outro cargo, afrouxa-se só o cg_select). anon nunca
-- alcança nada. A escrita de companies.group_id usa a policy de UPDATE de
-- companies que JÁ existe (companies_admin_all, is_admin()) — NÃO afrouxada; um
-- consultor não move empresa entre grupos nem por query direta.
-- =====================================================================

create table company_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  color      text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),  -- hex livre
  position   integer not null,                                    -- ordem de exibição
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Nome único ignorando maiúsculas (o erro amigável vem antes, na tela).
create unique index company_groups_name_lower_key on company_groups (lower(name));

alter table companies
  add column group_id uuid references company_groups(id) on delete set null;

create index companies_group_id_idx on companies (group_id);

-- ---------------------------------------------------------------------
-- RLS — todas admin-only (is_admin(), SECURITY DEFINER que deriva auth.uid()).
-- ---------------------------------------------------------------------
alter table company_groups enable row level security;

create policy cg_select on company_groups
  for select using (is_admin());

create policy cg_insert on company_groups
  for insert with check (is_admin());

create policy cg_update on company_groups
  for update using (is_admin()) with check (is_admin());

create policy cg_delete on company_groups
  for delete using (is_admin());

-- ---------------------------------------------------------------------
-- RPCs — SECURITY INVOKER (herdam o RLS de companies/company_groups, no desenho
-- de time_by_company / client_followup). Escrita SEMPRE em lote (nunca N idas do
-- navegador).
-- ---------------------------------------------------------------------

-- Move um conjunto de empresas para um grupo (p_group_id null = "Sem grupo").
-- UM único UPDATE. Devolve a QUANTIDADE de linhas REALMENTE afetadas, para a
-- interface avisar se o RLS barrou parte da seleção em vez de mentir sucesso
-- (um não-admin afeta 0 linhas: companies só tem UPDATE por is_admin()).
create or replace function set_companies_group(
  p_company_ids uuid[],
  p_group_id    uuid
)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  update companies
     set group_id   = p_group_id,
         updated_at = now()
   where id = any (p_company_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Grava position pela ORDEM do array (1-based). Non-admin afeta 0 linhas
-- (cg_update é is_admin()). position não é único: nenhum conflito transitório.
create or replace function reorder_company_groups(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  update company_groups g
     set position = t.ord
    from unnest(p_ids) with ordinality as t(id, ord)
   where g.id = t.id;
end;
$$;
