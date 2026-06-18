-- =====================================================================
-- CRM/Timer - Monvatti :: RLS e funções de acesso
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function auth_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- empresas que o usuário atual (consultor) é responsável
create or replace function my_consultant_companies()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select company_id from company_consultants where consultant_id = auth.uid();
$$;

-- empresas em que o usuário atual (colaborador) atua — DERIVADO das tarefas
-- (o colaborador vê uma empresa enquanto tiver ao menos uma tarefa nela)
create or replace function my_collaborator_companies()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select distinct company_id from task_instances where collaborator_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Ativar RLS em todas as tabelas
-- ---------------------------------------------------------------------
alter table profiles               enable row level security;
alter table companies              enable row level security;
alter table company_consultants    enable row level security;
alter table task_templates         enable row level security;
alter table task_instances         enable row level security;
alter table time_entries           enable row level security;
alter table activity_log           enable row level security;

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
-- cada um vê o próprio perfil; admin vê todos
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin());

-- usuário pode atualizar o próprio nome (não o próprio cargo); admin atualiza qualquer um
create policy profiles_update_self on profiles for update
  using (id = auth.uid() or is_admin())
  with check (
    is_admin()
    or (id = auth.uid() and role = (select role from profiles where id = auth.uid()))
  );

-- inserção do próprio profile no registro (trigger cuida disso, mas liberamos)
create policy profiles_insert_self on profiles for insert
  with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- COMPANIES
-- ---------------------------------------------------------------------
create policy companies_select on companies for select
  using (
    is_admin()
    or id in (select my_consultant_companies())
    or id in (select my_collaborator_companies())
  );

create policy companies_admin_all on companies for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- COMPANY_CONSULTANTS  (só admin gerencia; consultor lê o que é dele)
-- ---------------------------------------------------------------------
create policy cc_select on company_consultants for select
  using (is_admin() or consultant_id = auth.uid());
create policy cc_admin_all on company_consultants for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- (sem tabela company_collaborators — vínculo derivado das tarefas)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- TASK_TEMPLATES
-- admin: tudo | consultor: empresas dele | colaborador: leitura das suas
-- ---------------------------------------------------------------------
create policy tt_select on task_templates for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or collaborator_id = auth.uid()
  );
create policy tt_manage on task_templates for all
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
  )
  with check (
    is_admin()
    or company_id in (select my_consultant_companies())
  );

-- ---------------------------------------------------------------------
-- TASK_INSTANCES
-- colaborador vê/atualiza as próprias; consultor vê das suas empresas; admin tudo
-- ---------------------------------------------------------------------
create policy ti_select on task_instances for select
  using (
    is_admin()
    or collaborator_id = auth.uid()
    or company_id in (select my_consultant_companies())
  );

-- colaborador atualiza status/timer das próprias tarefas
create policy ti_update_collaborator on task_instances for update
  using (collaborator_id = auth.uid() or is_admin()
         or company_id in (select my_consultant_companies()))
  with check (collaborator_id = auth.uid() or is_admin()
         or company_id in (select my_consultant_companies()));

-- criação/exclusão por admin e consultor
create policy ti_manage on task_instances for all
  using (
    is_admin() or company_id in (select my_consultant_companies())
  )
  with check (
    is_admin() or company_id in (select my_consultant_companies())
  );

-- ---------------------------------------------------------------------
-- TIME_ENTRIES  (o colaborador dono registra; demais leem por hierarquia)
-- ---------------------------------------------------------------------
create policy te_select on time_entries for select
  using (
    is_admin()
    or collaborator_id = auth.uid()
    or task_id in (select id from task_instances
                   where company_id in (select my_consultant_companies()))
  );
create policy te_insert on time_entries for insert
  with check (collaborator_id = auth.uid());
create policy te_update on time_entries for update
  using (collaborator_id = auth.uid())
  with check (collaborator_id = auth.uid());

-- ---------------------------------------------------------------------
-- ACTIVITY_LOG
-- ---------------------------------------------------------------------
create policy al_select on activity_log for select
  using (
    is_admin()
    or collaborator_id = auth.uid()
    or company_id in (select my_consultant_companies())
  );
create policy al_insert on activity_log for insert
  with check (
    collaborator_id = auth.uid()
    or is_admin()
    or company_id in (select my_consultant_companies())
  );
