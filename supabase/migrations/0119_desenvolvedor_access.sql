-- =====================================================================
-- 0119 — Cargo "Desenvolvedor": acesso (molde do Gestor de Tráfego).
-- =====================================================================
-- Acesso EXATAMENTE a: quadro de Desenvolvimento (Painel), Agenda, Suporte,
-- notificações e o próprio perfil/senha. NEGADO POR PADRÃO, lista fechada abaixo.
--
-- Todos os desenvolvedores alcançam TODAS as empresas do quadro (sem carteira).
--
-- GENERALIZA o mecanismo do Gestor de Tráfego em vez de duplicar:
--  - board_area_for_role(role): gestor_trafego->'trafego', desenvolvedor->'site'.
--  - note_has_area(note, area): generaliza note_has_traffic_area.
--  - Onde a regra era "cargo de quadro lê/escreve só a área do seu quadro", UMA
--    cláusula cobre os dois cargos (board_area_for_role + note_has_area + as
--    empresas do quadro de cada um via my_traffic_companies()/my_dev_companies()).
--  - Regras NEGATIVAS de cargo viram LISTA POSITIVA (cn_delete).
-- Comportamento de admin/consultor/colaborador/gestor_trafego preservado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Correspondência cargo-de-quadro -> área (fonte única).
-- ---------------------------------------------------------------------
create or replace function board_area_for_role(p_role user_role)
returns note_area
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'gestor_trafego' then 'trafego'::note_area
    when 'desenvolvedor'  then 'site'::note_area
    else null::note_area
  end;
$$;
grant execute on function board_area_for_role(user_role) to authenticated;

-- ---------------------------------------------------------------------
-- 2) note_has_area generaliza note_has_traffic_area.
-- ---------------------------------------------------------------------
create or replace function note_has_area(p_note uuid, p_area note_area)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from company_note_areas where note_id = p_note and area = p_area
  );
$$;
grant execute on function note_has_area(uuid, note_area) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Alcance do desenvolvedor: TODAS as empresas do quadro (serviço de site).
--    Reaproveita dev_on_board. Vazio para os demais cargos (guard de cargo
--    atual, como my_traffic_companies / [[vinculo-exige-cargo-atual]]).
-- ---------------------------------------------------------------------
create or replace function my_dev_companies()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select cc.company_id from company_contracted_channels cc
  where cc.channel in ('gestao_site', 'desenvolvimento_site')
    and (select role from profiles where id = auth.uid()) = 'desenvolvedor';
$$;
grant execute on function my_dev_companies() to authenticated;

-- ---------------------------------------------------------------------
-- 4) Usuário interno e diretório de reuniões: incluir o desenvolvedor.
-- ---------------------------------------------------------------------
create or replace function is_internal_user(p_user uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = p_user
      and role in ('admin', 'consultor', 'colaborador', 'gestor_trafego', 'desenvolvedor')
  );
$$;

create or replace function meeting_directory()
returns table(id uuid, full_name text, email text, avatar_path text, role text)
language sql
stable security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.avatar_path, p.role
  from profiles p
  where p.role in ('admin', 'consultor', 'colaborador', 'gestor_trafego', 'desenvolvedor')
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------
-- 5) Alcance de empresa: branch do desenvolvedor (empresa no quadro de site).
-- ---------------------------------------------------------------------
create or replace function user_reaches_company(p_user uuid, p_company uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select p_company is not null and exists (
    select 1 from profiles pr
     where pr.id = p_user and (
       pr.role = 'admin'::user_role
       or (pr.role in ('admin'::user_role, 'consultor'::user_role)
           and exists (select 1 from company_consultants cc
                        where cc.company_id = p_company and cc.consultant_id = p_user))
       or (pr.role in ('admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role)
           and exists (select 1 from task_instances ti
                        where ti.company_id = p_company and ti.collaborator_id = p_user))
       or (pr.role = 'gestor_trafego'::user_role
           and exists (select 1 from company_contracted_channels ccc
                        where ccc.company_id = p_company and ccc.channel = 'trafego'))
       or (pr.role = 'desenvolvedor'::user_role and dev_on_board(p_company))
     )
  );
$$;

-- ---------------------------------------------------------------------
-- 6) Quadro de Desenvolvimento: admin e desenvolvedor gerenciam.
-- ---------------------------------------------------------------------
create or replace function dev_can_manage()
returns boolean
language sql
stable
set search_path = public
as $$
  select (select is_admin()) or (select auth_role()) = 'desenvolvedor';
$$;

-- RPCs de escrita do quadro viram SECURITY DEFINER (molde das traffic_set_* da
-- Fatia 4): a autorização é dev_can_manage() POR DENTRO; a escrita não depende de
-- policy de escrita em company_dev (o desenvolvedor NÃO escreve direto). auth.uid()
-- continua sendo o chamador (a auditoria registra quem foi).
create or replace function dev_set_status(p_company_id uuid, p_status dev_status)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lista         uuid;
  v_current_group uuid;
  v_target_group  uuid;
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores alteram o Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;

  select id into v_lista from dev_groups where name = 'Lista de Espera';

  select group_id into v_current_group from company_dev where company_id = p_company_id;
  v_current_group := coalesce(v_current_group, v_lista);

  v_target_group := coalesce(dev_group_for_status(p_status), v_current_group);

  insert into company_dev (company_id, group_id, status, updated_at, updated_by)
  values (p_company_id, v_target_group, p_status, now(), auth.uid())
  on conflict (company_id) do update
    set group_id = excluded.group_id, status = excluded.status,
        updated_at = now(), updated_by = auth.uid();
end;
$$;
grant execute on function dev_set_status(uuid, dev_status) to authenticated;

create or replace function dev_move_company(p_company_id uuid, p_dev_group_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status dev_status;
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores alteram o Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;

  v_status := dev_status_for_group(p_dev_group_id);
  if v_status is null then
    raise exception 'Grupo de destino inválido.' using errcode = 'check_violation';
  end if;

  insert into company_dev (company_id, group_id, status, updated_at, updated_by)
  values (p_company_id, p_dev_group_id, v_status, now(), auth.uid())
  on conflict (company_id) do update
    set group_id = excluded.group_id, status = excluded.status,
        updated_at = now(), updated_by = auth.uid();
end;
$$;
grant execute on function dev_move_company(uuid, uuid) to authenticated;

create or replace function dev_pause_deadline(p_company_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores alteram o Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;
  if v_reason = '' then
    raise exception 'Informe o motivo da pausa.' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Motivo muito longo (máx. 500 caracteres).' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from company_dev cd
      join dev_groups g on g.id = cd.group_id
     where cd.company_id = p_company_id and g.name = 'Em Desenvolvimento'
  ) then
    raise exception 'Só é possível pausar o prazo de uma empresa em Em Desenvolvimento.'
      using errcode = 'check_violation';
  end if;

  update company_dev
     set manual_paused = true, pause_reason = v_reason, paused_at = now(), paused_by = auth.uid(),
         updated_at = now(), updated_by = auth.uid()
   where company_id = p_company_id;
end;
$$;
grant execute on function dev_pause_deadline(uuid, text) to authenticated;

create or replace function dev_resume_deadline(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores alteram o Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;

  update company_dev
     set manual_paused = false, pause_reason = null, paused_at = null, paused_by = null,
         updated_at = now(), updated_by = auth.uid()
   where company_id = p_company_id and manual_paused = true;
end;
$$;
grant execute on function dev_resume_deadline(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Menções: nova fonte 'atualizacao_site' (painel do Desenvolvimento) e a
--    validação por cargo-de-quadro generalizada por board_area_for_role.
-- ---------------------------------------------------------------------
create or replace function mentionable_users(p_source_type text, p_company uuid)
returns table(id uuid, full_name text, avatar_path text)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(auth.uid()) then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p
      where p.role in ('admin', 'consultor', 'colaborador', 'gestor_trafego', 'desenvolvedor') order by p.full_name;
  elsif p_source_type in ('atualizacao', 'atualizacao_resposta') then
    if not user_reaches_company(auth.uid(), p_company) then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p
      where p.role = 'admin'
         or exists (select 1 from company_consultants c where c.company_id = p_company and c.consultant_id = p.id)
         or exists (select 1 from task_instances t where t.company_id = p_company and t.collaborator_id = p.id)
      order by p.full_name;
  elsif p_source_type = 'atualizacao_trafego' then
    if not user_reaches_company(auth.uid(), p_company) then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p
      where p.role = 'admin' or p.role = 'gestor_trafego'
         or exists (select 1 from company_consultants c where c.company_id = p_company and c.consultant_id = p.id)
         or exists (select 1 from task_instances t where t.company_id = p_company and t.collaborator_id = p.id)
      order by p.full_name;
  elsif p_source_type = 'atualizacao_site' then
    if not user_reaches_company(auth.uid(), p_company) then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p
      where p.role = 'admin' or p.role = 'desenvolvedor'
         or exists (select 1 from company_consultants c where c.company_id = p_company and c.consultant_id = p.id)
         or exists (select 1 from task_instances t where t.company_id = p_company and t.collaborator_id = p.id)
      order by p.full_name;
  elsif p_source_type in ('cs_note', 'cs_note_reply') then
    if not is_admin() then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p where p.role = 'admin' order by p.full_name;
  end if;
end;
$$;

create or replace function sync_content_mentions(p_source_type text, p_source_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_caller uuid := auth.uid(); v_company uuid; v_valid uuid[]; v_is_cs boolean := false; v_note uuid;
begin
  if p_source_type = 'atualizacao' then
    select company_id into v_company from company_notes where id = p_source_id;
    if v_company is null then return; end if;
    v_note := p_source_id;
  elsif p_source_type = 'atualizacao_resposta' then
    select n.company_id, n.id into v_company, v_note from company_note_replies r join company_notes n on n.id = r.note_id where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'cs_note' then
    v_is_cs := true; select company_id into v_company from cs_notes where id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'cs_note_reply' then
    v_is_cs := true; select n.company_id into v_company from cs_note_replies r join cs_notes n on n.id = r.note_id where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    v_company := null;
  else
    raise exception 'source_type invalido: %', p_source_type;
  end if;

  if v_is_cs then
    if not is_admin() then raise exception 'sem acesso ao contexto'; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(v_caller) then raise exception 'sem acesso ao contexto'; end if;
  else
    if not user_reaches_company(v_caller, v_company) then raise exception 'sem acesso ao contexto'; end if;
  end if;

  -- Validação por usuário marcado. Um CARGO DE QUADRO (gestor_trafego/
  -- desenvolvedor) só é menção válida se a nota tiver a ÁREA do quadro dele
  -- (board_area_for_role) — mesma regra, dois cargos. Os demais: alcance normal.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_valid
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where case
    when v_is_cs then (select role from profiles where id = u) = 'admin'
    when p_source_type in ('chamado', 'chamado_resposta') then is_internal_user(u)
    when board_area_for_role((select role from profiles where id = u)) is not null then
      exists (select 1 from company_note_areas a
               where a.note_id = v_note
                 and a.area = board_area_for_role((select role from profiles where id = u)))
    else user_reaches_company(u, v_company)
  end;

  delete from content_mentions where source_type = p_source_type and source_id = p_source_id and not (mentioned_user_id = any (v_valid));
  insert into content_mentions (mentioned_user_id, author_id, source_type, source_id, company_id)
  select u, v_caller, p_source_type, p_source_id, v_company from unnest(v_valid) as u
  on conflict (source_type, source_id, mentioned_user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) companies (SELECT): incluir o desenvolvedor via my_dev_companies().
-- ---------------------------------------------------------------------
drop policy if exists companies_select on companies;
create policy companies_select on companies
  for select using (
    is_admin()
    or (id in (select my_consultant_companies()))
    or (id in (select my_collaborator_companies()))
    or (id in (select my_traffic_companies()))
    or (id in (select my_dev_companies()))
  );

-- ---------------------------------------------------------------------
-- 9) company_notes: SELECT/INSERT/UPDATE com a cláusula de quadro unificada;
--    DELETE reescrito em LISTA POSITIVA (era auth_role() <> 'gestor_trafego').
-- ---------------------------------------------------------------------
drop policy if exists cn_select on company_notes;
create policy cn_select on company_notes
  for select using (
    is_admin()
    or (company_id in (select my_consultant_companies()))
    or (company_id in (select my_collaborator_companies()))
    or (board_area_for_role((select auth_role())) is not null
        and (company_id in (select my_traffic_companies()) or company_id in (select my_dev_companies()))
        and note_has_area(id, board_area_for_role((select auth_role()))))
  );

drop policy if exists cn_insert on company_notes;
create policy cn_insert on company_notes
  for insert with check (
    (author_id = (select auth.uid()))
    and (
      is_admin()
      or (company_id in (select my_consultant_companies()))
      or (company_id in (select my_collaborator_companies()))
      or (board_area_for_role((select auth_role())) is not null
          and note_origin_area(origin) = board_area_for_role((select auth_role()))
          and (company_id in (select my_traffic_companies()) or company_id in (select my_dev_companies())))
    )
  );

drop policy if exists cn_update on company_notes;
create policy cn_update on company_notes
  for update using (
    is_admin()
    or ((author_id = (select auth.uid()))
        and ((company_id in (select my_consultant_companies())) or (company_id in (select my_collaborator_companies()))))
    or ((author_id = (select auth.uid()))
        and board_area_for_role((select auth_role())) is not null
        and (company_id in (select my_traffic_companies()) or company_id in (select my_dev_companies()))
        and note_has_area(id, board_area_for_role((select auth_role()))))
  ) with check (
    is_admin()
    or ((author_id = (select auth.uid()))
        and ((company_id in (select my_consultant_companies())) or (company_id in (select my_collaborator_companies()))))
    or ((author_id = (select auth.uid()))
        and board_area_for_role((select auth_role())) is not null
        and (company_id in (select my_traffic_companies()) or company_id in (select my_dev_companies()))
        and note_has_area(id, board_area_for_role((select auth_role()))))
  );

-- LISTA POSITIVA: admin, ou autor com cargo consultor/colaborador. Cargos de
-- quadro (gestor_trafego/desenvolvedor) NÃO excluem Atualizações.
drop policy if exists cn_delete on company_notes;
create policy cn_delete on company_notes
  for delete using (
    is_admin()
    or ((author_id = (select auth.uid())) and (select auth_role()) in ('consultor'::user_role, 'colaborador'::user_role))
  );

-- ---------------------------------------------------------------------
-- 10) company_note_areas: espelha cn_select (SELECT) e cn de autoria (INSERT/
--     DELETE). A trava de origin->área continua nos gatilhos (0117).
-- ---------------------------------------------------------------------
drop policy if exists cna_select on company_note_areas;
create policy cna_select on company_note_areas
  for select using (
    exists (
      select 1 from company_notes n
       where n.id = company_note_areas.note_id and (
         is_admin()
         or (n.company_id in (select my_consultant_companies()))
         or (n.company_id in (select my_collaborator_companies()))
         or (board_area_for_role((select auth_role())) is not null
             and (n.company_id in (select my_traffic_companies()) or n.company_id in (select my_dev_companies()))
             and note_has_area(n.id, board_area_for_role((select auth_role()))))
       )
    )
  );

drop policy if exists cna_insert on company_note_areas;
create policy cna_insert on company_note_areas
  for insert with check (
    exists (
      select 1 from company_notes n
       where n.id = company_note_areas.note_id and (
         is_admin()
         or ((n.author_id = (select auth.uid()))
             and ((n.company_id in (select my_consultant_companies())) or (n.company_id in (select my_collaborator_companies()))))
         or ((n.author_id = (select auth.uid()))
             and board_area_for_role((select auth_role())) is not null
             and (n.company_id in (select my_traffic_companies()) or n.company_id in (select my_dev_companies())))
       )
    )
  );

drop policy if exists cna_delete on company_note_areas;
create policy cna_delete on company_note_areas
  for delete using (
    exists (
      select 1 from company_notes n
       where n.id = company_note_areas.note_id and (
         is_admin()
         or ((n.author_id = (select auth.uid()))
             and ((n.company_id in (select my_consultant_companies())) or (n.company_id in (select my_collaborator_companies()))))
         or ((n.author_id = (select auth.uid()))
             and board_area_for_role((select auth_role())) is not null
             and (n.company_id in (select my_traffic_companies()) or n.company_id in (select my_dev_companies())))
       )
    )
  );

-- ---------------------------------------------------------------------
-- 11) company_note_replies: SELECT das respostas de notas que lê; INSERT nessas
--     notas como autor. (UPDATE das próprias segue como está — cnr_update.)
-- ---------------------------------------------------------------------
drop policy if exists cnr_select on company_note_replies;
create policy cnr_select on company_note_replies
  for select using (
    exists (
      select 1 from company_notes n
       where n.id = company_note_replies.note_id and (
         is_admin()
         or (n.company_id in (select my_consultant_companies()))
         or (n.company_id in (select my_collaborator_companies()))
         or (board_area_for_role((select auth_role())) is not null
             and (n.company_id in (select my_traffic_companies()) or n.company_id in (select my_dev_companies()))
             and note_has_area(n.id, board_area_for_role((select auth_role()))))
       )
    )
  );

drop policy if exists cnr_insert on company_note_replies;
create policy cnr_insert on company_note_replies
  for insert with check (
    (author_id = (select auth.uid()))
    and exists (
      select 1 from company_notes n
       where n.id = company_note_replies.note_id and (
         is_admin()
         or (n.company_id in (select my_consultant_companies()))
         or (n.company_id in (select my_collaborator_companies()))
         or (board_area_for_role((select auth_role())) is not null
             and (n.company_id in (select my_traffic_companies()) or n.company_id in (select my_dev_companies()))
             and note_has_area(n.id, board_area_for_role((select auth_role()))))
       )
    )
  );

-- ---------------------------------------------------------------------
-- 12) Suporte: desenvolvedor entra nas listas de cargos (abrir/ver/responder).
-- ---------------------------------------------------------------------
drop policy if exists st_select on support_tickets;
create policy st_select on support_tickets
  for select using (
    auth_role() = any (array['admin','consultor','colaborador','gestor_trafego','desenvolvedor']::user_role[])
  );

drop policy if exists st_insert on support_tickets;
create policy st_insert on support_tickets
  for insert with check (
    (created_by = (select auth.uid()))
    and ((select auth_role()) = any (array['admin','consultor','colaborador','gestor_trafego','desenvolvedor']::user_role[]))
    and (company_id in (select companies.id from companies))
  );

drop policy if exists st_update on support_tickets;
create policy st_update on support_tickets
  for update using (
    auth_role() = any (array['admin','consultor','colaborador','gestor_trafego','desenvolvedor']::user_role[])
  ) with check (
    auth_role() = any (array['admin','consultor','colaborador','gestor_trafego','desenvolvedor']::user_role[])
  );

drop policy if exists str_select on support_ticket_replies;
create policy str_select on support_ticket_replies
  for select using (
    auth_role() = any (array['admin','consultor','colaborador','gestor_trafego','desenvolvedor']::user_role[])
  );

drop policy if exists str_insert on support_ticket_replies;
create policy str_insert on support_ticket_replies
  for insert with check (
    (author_id = auth.uid())
    and (auth_role() = any (array['admin','consultor','colaborador','gestor_trafego','desenvolvedor']::user_role[]))
  );

-- ---------------------------------------------------------------------
-- 13) Agenda: criar reunião para empresa que o desenvolvedor alcança.
-- ---------------------------------------------------------------------
drop policy if exists meetings_insert on meetings;
create policy meetings_insert on meetings
  for insert with check (
    (created_by = auth.uid())
    and (
      is_admin()
      or (company_id in (select my_consultant_companies()))
      or (company_id in (select my_collaborator_companies()))
      or (company_id in (select my_traffic_companies()))
      or (company_id in (select my_dev_companies()))
    )
  );

-- ---------------------------------------------------------------------
-- 14) Tabelas do quadro de Desenvolvimento: SELECT para o desenvolvedor.
--     (dev_clock_periods_select já usa dev_can_manage() -> cobre sozinho.)
--     Escrita continua só por RPC (DEFINER). dev_audit append-only.
-- ---------------------------------------------------------------------
drop policy if exists dev_groups_select on dev_groups;
create policy dev_groups_select on dev_groups
  for select using ((select is_admin()) or (select auth_role()) = 'desenvolvedor');

drop policy if exists dev_audit_select on dev_audit;
create policy dev_audit_select on dev_audit
  for select using ((select is_admin()) or (select auth_role()) = 'desenvolvedor');

-- company_dev: mantém a policy ALL do admin; acrescenta SELECT ao desenvolvedor
-- (sem policy de escrita para ele — escreve via RPC DEFINER).
drop policy if exists company_dev_dev_select on company_dev;
create policy company_dev_dev_select on company_dev
  for select using ((select auth_role()) = 'desenvolvedor');

-- ---------------------------------------------------------------------
-- 15) Limpeza: note_has_traffic_area não é mais referenciada (todas as policies
--     passaram a usar note_has_area).
-- ---------------------------------------------------------------------
drop function if exists note_has_traffic_area(uuid);
