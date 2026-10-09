-- 0113_vinculo_requires_current_role
--
-- Problema: trocar o cargo de uma pessoa carregava o acesso antigo, porque o
-- acesso por VÍNCULO decidia só pela existência da linha de vínculo, sem conferir
-- o cargo ATUAL. Um ex-colaborador virado gestor_trafego (ou 'pending') continuava
-- alcançando empresas pelas linhas antigas de company_collaborators e pelas
-- task_instances.collaborator_id, lendo notas, faturamento, eventos e detalhes.
--
-- Solução: acesso por vínculo passa a exigir cargo atual compatível. NENHUM vínculo,
-- tarefa ou tempo é apagado; só o ACESSO é condicionado ao cargo. Se a pessoa voltar
-- ao cargo antigo, o acesso volta.
--
-- Regras (decididas):
--   * Vínculo de consultor (company_consultants)            -> só cargo em (admin, consultor).
--   * Vínculo de colaborador (company_collaborators) e
--     tarefa atribuída (task_instances.collaborator_id)     -> só cargo em (admin, consultor, colaborador).
--   * 'pending' e 'gestor_trafego' NÃO herdam nada de vínculos. O gestor continua
--     alcançando só o que vem de my_traffic_companies().
--   * Admin aparece em 35 vínculos de consultor: 'admin' está em ambos os conjuntos
--     e, além disso, is_admin() continua cobrindo tudo; admin não perde nada.
--
-- Cargo lido com (select auth_role()) nas policies; nas funções SECURITY DEFINER,
-- uma leitura de profiles por chamada.

-- ============================================================================
-- 1) Funções que devolvem "as empresas que alcanço por vínculo"
-- ============================================================================

-- Consultor: só vale se o cargo atual for admin ou consultor.
create or replace function public.my_consultant_companies()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select company_id
    from company_consultants
   where consultant_id = auth.uid()
     and (select role from profiles where id = auth.uid())
         in ('admin'::user_role, 'consultor'::user_role);
$$;

-- Colaborador (vínculo declarado OU tarefa atribuída): só vale se o cargo atual
-- for admin, consultor ou colaborador. Uma única leitura do cargo por chamada.
create or replace function public.my_collaborator_companies()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select company_id
    from (
      select company_id from company_collaborators where collaborator_id = auth.uid()
      union
      select distinct company_id from task_instances where collaborator_id = auth.uid()
    ) v
   where (select role from profiles where id = auth.uid())
         in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role);
$$;

-- "Fulano alcança a empresa?" (usada hoje só por menções). Cada ramo de vínculo
-- passa a exigir o cargo atual do p_user; o ramo gestor_trafego continua igual.
create or replace function public.user_reaches_company(p_user uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_company is not null and exists (
    select 1
      from profiles pr
     where pr.id = p_user
       and (
         pr.role = 'admin'::user_role
         or (
           pr.role in ('admin'::user_role, 'consultor'::user_role)
           and exists (
             select 1 from company_consultants cc
              where cc.company_id = p_company and cc.consultant_id = p_user
           )
         )
         or (
           pr.role in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
           and exists (
             select 1 from task_instances ti
              where ti.company_id = p_company and ti.collaborator_id = p_user
           )
         )
         or (
           pr.role = 'gestor_trafego'::user_role
           and exists (
             select 1 from company_contracted_channels ccc
              where ccc.company_id = p_company and ccc.channel = 'trafego'
           )
         )
       )
  );
$$;

-- ============================================================================
-- 2) Policies com vínculo DIRETO (fora das funções acima)
--    Só os ramos de vínculo ganham o guard de cargo; is_admin() e os ramos por
--    my_*_companies() ficam intactos (estes já são corrigidos pelas funções).
-- ============================================================================

-- company_consultants: ver a própria linha de vínculo de consultor
alter policy cc_select on public.company_consultants
  using (
    is_admin()
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role)
      and consultant_id = auth.uid()
    )
  );

-- company_collaborators: ver a própria linha de vínculo de colaborador
alter policy ccol_select on public.company_collaborators
  using (
    is_admin()
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and collaborator_id = auth.uid()
    )
    or (company_id in (select my_consultant_companies()))
    or (company_id in (select my_collaborator_companies()))
  );

-- task_instances: linha própria (tarefa atribuída a mim)
alter policy ti_select on public.task_instances
  using (
    is_admin()
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and collaborator_id = (select auth.uid())
    )
    or (company_id in (select my_consultant_companies()))
  );

alter policy ti_update_collaborator on public.task_instances
  using (
    (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and collaborator_id = (select auth.uid())
    )
    or is_admin()
    or (company_id in (select my_consultant_companies()))
  )
  with check (
    (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and collaborator_id = (select auth.uid())
    )
    or is_admin()
    or (company_id in (select my_consultant_companies()))
  );

-- time_entries: lançar / ver / editar o próprio tempo
alter policy te_insert on public.time_entries
  with check (
    (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
    and collaborator_id = auth.uid()
  );

alter policy te_select on public.time_entries
  using (
    is_admin()
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and collaborator_id = auth.uid()
    )
    or (task_id in (
          select task_instances.id from task_instances
           where task_instances.company_id in (select my_consultant_companies())
       ))
  );

alter policy te_update on public.time_entries
  using (
    (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
    and collaborator_id = (select auth.uid())
  )
  with check (
    (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
    and collaborator_id = (select auth.uid())
  );

-- time_adjustments: ver ajustes das minhas tarefas (tarefa atribuída a mim)
alter policy ta_select on public.time_adjustments
  using (
    is_admin()
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and task_id in (
        select task_instances.id from task_instances
         where task_instances.collaborator_id = auth.uid()
      )
    )
    or (task_id in (
          select task_instances.id from task_instances
           where task_instances.company_id in (select my_consultant_companies())
       ))
  );

-- listing_results: escrever resultado da listagem da minha tarefa
--   (lr_select = "task_id in (select id from task_instances)" respeita a RLS de
--    task_instances, então já afunila sozinho pela ti_select; não muda aqui.)
alter policy lr_write on public.listing_results
  using (
    (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
    and task_id in (
      select task_instances.id from task_instances
       where task_instances.collaborator_id = (select auth.uid())
    )
  )
  with check (
    (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
    and task_id in (
      select task_instances.id from task_instances
       where task_instances.collaborator_id = (select auth.uid())
    )
  );

-- listing_validations: ver / inserir validação interna pela tarefa atribuída a mim
alter policy lv_select on public.listing_validations
  using (
    is_admin()
    or (company_id in (select my_consultant_companies()))
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and listing_result_id in (
        select lr.id from listing_results lr
          join task_instances ti on ti.id = lr.task_id
         where ti.collaborator_id = auth.uid()
      )
    )
  );

alter policy lv_insert_interno on public.listing_validations
  with check (
    (author_type = 'interno'::text)
    and (author_id = auth.uid())
    and (
      is_admin()
      or (company_id in (select my_consultant_companies()))
      or (
        (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
        and listing_result_id in (
          select lr.id from listing_results lr
            join task_instances ti on ti.id = lr.task_id
           where ti.collaborator_id = auth.uid()
        )
      )
    )
  );

-- task_templates: colaborador vê o molde atribuído a ele (vínculo de tarefa)
alter policy tt_select on public.task_templates
  using (
    is_admin()
    or (company_id in (select my_consultant_companies()))
    or (
      (select auth_role()) in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
      and collaborator_id = auth.uid()
    )
  );

-- NOTA — activity_log (al_insert / al_select) usa `collaborator_id = auth.uid()`,
-- mas `collaborator_id` aqui é o AUTOR do próprio registro de atividade, não um
-- vínculo com a empresa (não é company_consultants / company_collaborators /
-- task_instances.collaborator_id). Fica como está (linha do próprio ator); o ramo
-- por my_consultant_companies() dessa tabela já é corrigido pelas funções acima.
