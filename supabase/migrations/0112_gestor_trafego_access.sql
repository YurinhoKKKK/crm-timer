-- =====================================================================
-- 0112 — Cargo "Gestor de Tráfego" (Fatia 4), PASSO 2: acesso da LISTA FECHADA.
-- =====================================================================
-- NEGADO POR PADRÃO. O gestor_trafego só ganha EXATAMENTE: quadro de Tráfego
-- (Painel), Agenda, Suporte, notificações e o próprio perfil/senha. Qualquer
-- policy/função não tocada aqui continua negando o gestor.
--
-- Hoje há UM gestor que alcança TODAS as empresas do quadro (com 'trafego'). Se
-- surgir um segundo, vira carteira — não construído agora (my_traffic_companies
-- é o único ponto a mudar).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Alcance de empresas do gestor (DEFINER, search_path fixo): as empresas com
--    'trafego'. Vazio para quem não é gestor_trafego.
-- ---------------------------------------------------------------------
create or replace function my_traffic_companies()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select cc.company_id
  from company_contracted_channels cc
  where cc.channel = 'trafego'
    and (select role from profiles where id = auth.uid()) = 'gestor_trafego';
$$;
grant execute on function my_traffic_companies() to authenticated;

-- ---------------------------------------------------------------------
-- 2) user_reaches_company(): considera o gestor para empresas de
--    my_traffic_companies() (empresas com 'trafego'). Usado só por
--    mentionable_users e sync_content_mentions (nenhuma policy usa esta função).
-- ---------------------------------------------------------------------
create or replace function user_reaches_company(p_user uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_company is not null and (
    exists (select 1 from profiles where id = p_user and role = 'admin')
    or exists (select 1 from company_consultants where company_id = p_company and consultant_id = p_user)
    or exists (select 1 from task_instances where company_id = p_company and collaborator_id = p_user)
    or (
      exists (select 1 from profiles where id = p_user and role = 'gestor_trafego')
      and exists (select 1 from company_contracted_channels
                   where company_id = p_company and channel = 'trafego')
    )
  );
$$;

-- ---------------------------------------------------------------------
-- 3) is_internal_user(): inclui o gestor. Usos (inventariados): mentionable_users
--    e sync_content_mentions, ambos no ramo de CHAMADO (Suporte). Nenhuma policy
--    usa esta função — incluir o gestor só o torna interno para menções de
--    chamado, exatamente o desejado.
-- ---------------------------------------------------------------------
create or replace function is_internal_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = p_user
      and role in ('admin', 'consultor', 'colaborador', 'gestor_trafego')
  );
$$;

-- ---------------------------------------------------------------------
-- 4) meeting_directory(): inclui o gestor (ele é interno na Agenda — pode ser
--    convidado e aparece no diretório).
-- ---------------------------------------------------------------------
create or replace function meeting_directory()
returns table(id uuid, full_name text, email text, avatar_path text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.avatar_path, p.role
  from profiles p
  where p.role in ('admin', 'consultor', 'colaborador', 'gestor_trafego')
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------
-- 5) companies (SELECT): acrescenta o gestor via my_traffic_companies(). Só
--    SELECT — o gestor não cria/edita/exclui empresa (companies_admin_all intacto).
-- ---------------------------------------------------------------------
drop policy companies_select on companies;
create policy companies_select on companies for select using (
  is_admin()
  or id in (select my_consultant_companies())
  or id in (select my_collaborator_companies())
  or id in (select my_traffic_companies())
);

-- ---------------------------------------------------------------------
-- 6) traffic_groups (SELECT) p/ o gestor. Escrita (tg_write) continua só admin.
-- ---------------------------------------------------------------------
drop policy tg_select on traffic_groups;
create policy tg_select on traffic_groups for select using (
  (select is_admin()) or (select auth_role()) = 'gestor_trafego'
);

-- ---------------------------------------------------------------------
-- 7) company_traffic (SELECT) p/ o gestor. Escrita segue só admin
--    (company_traffic_all) + as RPCs traffic_set_*/move (abaixo).
-- ---------------------------------------------------------------------
create policy company_traffic_gestor_select on company_traffic for select using (
  (select auth_role()) = 'gestor_trafego'
  and company_id in (select my_traffic_companies())
);

-- ---------------------------------------------------------------------
-- 8) traffic_audit (SELECT) p/ o gestor (histórico do quadro). Append-only p/ todos.
-- ---------------------------------------------------------------------
drop policy traffic_audit_select on traffic_audit;
create policy traffic_audit_select on traffic_audit for select using (
  (select is_admin())
  or (
    (select auth_role()) = 'gestor_trafego'
    and company_id in (select my_traffic_companies())
  )
);

-- ---------------------------------------------------------------------
-- 8b) Helper DEFINER: a nota tem a área 'trafego'? Necessário para QUEBRAR a
--     recursão de RLS — sem ele, cn_select (company_notes) consultaria
--     company_note_areas, cujo cna_select consulta company_notes de volta
--     (recursão infinita). Lido por dentro do DEFINER, não reavalia policies.
-- ---------------------------------------------------------------------
create or replace function note_has_traffic_area(p_note uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from company_note_areas where note_id = p_note and area = 'trafego');
$$;
grant execute on function note_has_traffic_area(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9) Atualizações (company_notes) — só as de empresa do quadro COM área 'trafego'.
-- ---------------------------------------------------------------------
drop policy cn_select on company_notes;
create policy cn_select on company_notes for select using (
  is_admin()
  or company_id in (select my_consultant_companies())
  or company_id in (select my_collaborator_companies())
  or (
    (select auth_role()) = 'gestor_trafego'
    and company_id in (select my_traffic_companies())
    and note_has_traffic_area(company_notes.id)
  )
);

-- insert do gestor: só origin='traffic', empresa do quadro, autor = ele.
drop policy cn_insert on company_notes;
create policy cn_insert on company_notes for insert with check (
  (author_id = (select auth.uid())) and (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
    or (
      (select auth_role()) = 'gestor_trafego'
      and origin = 'traffic'
      and company_id in (select my_traffic_companies())
    )
  )
);

-- update do gestor: só as notas dele, e só se tiverem a área 'trafego'.
drop policy cn_update on company_notes;
create policy cn_update on company_notes for update using (
  is_admin()
  or (
    (author_id = (select auth.uid())) and (
      company_id in (select my_consultant_companies())
      or company_id in (select my_collaborator_companies())
    )
  )
  or (
    (select auth_role()) = 'gestor_trafego'
    and author_id = (select auth.uid())
    and company_id in (select my_traffic_companies())
    and note_has_traffic_area(company_notes.id)
  )
) with check (
  is_admin()
  or (
    (author_id = (select auth.uid())) and (
      company_id in (select my_consultant_companies())
      or company_id in (select my_collaborator_companies())
    )
  )
  or (
    (select auth_role()) = 'gestor_trafego'
    and author_id = (select auth.uid())
    and company_id in (select my_traffic_companies())
    and note_has_traffic_area(company_notes.id)
  )
);

-- delete: o gestor NUNCA exclui nota. A policy antiga liberava qualquer autor;
-- agora o ramo de autor exclui o gestor (admin segue por is_admin()).
drop policy cn_delete on company_notes;
create policy cn_delete on company_notes for delete using (
  is_admin()
  or (author_id = (select auth.uid()) and (select auth_role()) <> 'gestor_trafego')
);

-- ---------------------------------------------------------------------
-- 10) company_note_areas — select das notas que o gestor lê; insert/delete só nas
--     dele (a trava da 0110 segue impedindo remover 'trafego' de origin='traffic').
-- ---------------------------------------------------------------------
drop policy cna_select on company_note_areas;
create policy cna_select on company_note_areas for select using (
  exists (select 1 from company_notes n where n.id = company_note_areas.note_id and (
    is_admin()
    or n.company_id in (select my_consultant_companies())
    or n.company_id in (select my_collaborator_companies())
    or (
      (select auth_role()) = 'gestor_trafego'
      and n.company_id in (select my_traffic_companies())
      and note_has_traffic_area(n.id)
    )
  ))
);

drop policy cna_insert on company_note_areas;
create policy cna_insert on company_note_areas for insert with check (
  exists (select 1 from company_notes n where n.id = company_note_areas.note_id and (
    is_admin()
    or (
      (n.author_id = (select auth.uid())) and (
        n.company_id in (select my_consultant_companies())
        or n.company_id in (select my_collaborator_companies())
      )
    )
    or (
      (select auth_role()) = 'gestor_trafego'
      and n.author_id = (select auth.uid())
      and n.company_id in (select my_traffic_companies())
    )
  ))
);

drop policy cna_delete on company_note_areas;
create policy cna_delete on company_note_areas for delete using (
  exists (select 1 from company_notes n where n.id = company_note_areas.note_id and (
    is_admin()
    or (
      (n.author_id = (select auth.uid())) and (
        n.company_id in (select my_consultant_companies())
        or n.company_id in (select my_collaborator_companies())
      )
    )
    or (
      (select auth_role()) = 'gestor_trafego'
      and n.author_id = (select auth.uid())
      and n.company_id in (select my_traffic_companies())
    )
  ))
);

-- ---------------------------------------------------------------------
-- 11) company_note_replies — select das respostas de notas que o gestor lê;
--     insert como autor nessas notas. cnr_update (author=auth.uid) já serve.
-- ---------------------------------------------------------------------
drop policy cnr_select on company_note_replies;
create policy cnr_select on company_note_replies for select using (
  exists (select 1 from company_notes n where n.id = company_note_replies.note_id and (
    is_admin()
    or n.company_id in (select my_consultant_companies())
    or n.company_id in (select my_collaborator_companies())
    or (
      (select auth_role()) = 'gestor_trafego'
      and n.company_id in (select my_traffic_companies())
      and note_has_traffic_area(n.id)
    )
  ))
);

drop policy cnr_insert on company_note_replies;
create policy cnr_insert on company_note_replies for insert with check (
  (author_id = (select auth.uid())) and
  exists (select 1 from company_notes n where n.id = company_note_replies.note_id and (
    is_admin()
    or n.company_id in (select my_consultant_companies())
    or n.company_id in (select my_collaborator_companies())
    or (
      (select auth_role()) = 'gestor_trafego'
      and n.company_id in (select my_traffic_companies())
      and note_has_traffic_area(n.id)
    )
  ))
);

-- ---------------------------------------------------------------------
-- 12) Suporte — inclui gestor_trafego nas listas de cargos (abre chamado só com
--     empresa que alcança: st_insert mantém company_id in companies, recortado
--     pela RLS de companies acima).
-- ---------------------------------------------------------------------
drop policy st_select on support_tickets;
create policy st_select on support_tickets for select using (
  auth_role() = any (array['admin','consultor','colaborador','gestor_trafego']::user_role[])
);

drop policy st_insert on support_tickets;
create policy st_insert on support_tickets for insert with check (
  (created_by = (select auth.uid()))
  and ((select auth_role()) = any (array['admin','consultor','colaborador','gestor_trafego']::user_role[]))
  and (company_id in (select companies.id from companies))
);

drop policy st_update on support_tickets;
create policy st_update on support_tickets for update using (
  auth_role() = any (array['admin','consultor','colaborador','gestor_trafego']::user_role[])
) with check (
  auth_role() = any (array['admin','consultor','colaborador','gestor_trafego']::user_role[])
);

drop policy str_select on support_ticket_replies;
create policy str_select on support_ticket_replies for select using (
  auth_role() = any (array['admin','consultor','colaborador','gestor_trafego']::user_role[])
);

drop policy str_insert on support_ticket_replies;
create policy str_insert on support_ticket_replies for insert with check (
  (author_id = auth.uid())
  and (auth_role() = any (array['admin','consultor','colaborador','gestor_trafego']::user_role[]))
);

-- ---------------------------------------------------------------------
-- 13) Agenda — o gestor cria reunião com empresa que alcança (my_traffic_companies).
--     Visibilidade (meeting_is_visible = autenticado) e resposta a convite
--     (set_my_meeting_response) já servem a todo interno; participantes por
--     organizador (created_by) também.
-- ---------------------------------------------------------------------
drop policy meetings_insert on meetings;
create policy meetings_insert on meetings for insert with check (
  (created_by = auth.uid()) and (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
    or company_id in (select my_traffic_companies())
  )
);

-- ---------------------------------------------------------------------
-- 13b) traffic_on_board()/traffic_is_synced() passam a SECURITY DEFINER: as RPCs
--      de edição/movimento (invoker) as chamam, e o gestor NÃO lê
--      company_contracted_channels — sem DEFINER elas voltariam false para ele.
--      São checagens booleanas por empresa, sem vazamento.
-- ---------------------------------------------------------------------
create or replace function traffic_on_board(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id and channel = 'trafego'
  )
$$;

create or replace function traffic_is_synced(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id and channel = 'trafego'
  ) and exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id and channel in ('mercado_livre', 'shopee', 'amazon')
  )
$$;

-- ---------------------------------------------------------------------
-- 14) traffic_board() — agora SECURITY DEFINER (admin e gestor), devolvendo
--     TAMBÉM as etiquetas efetivas (via company_effective_labels, lida dentro do
--     DEFINER) e o GRUPO DO TRÁFEGO JÁ RESOLVIDO (traffic_group_id): sincronizada
--     = correspondência de Empresas; manual = coalesce(manual, correspondência).
--     Assim o gestor NÃO precisa de company_details/company_contracted_channels/
--     company_labels/company_groups. DROP + CREATE (retorno muda).
-- ---------------------------------------------------------------------
drop function if exists public.traffic_board();

create function public.traffic_board()
returns table (
  id uuid, name text, group_id uuid, synced boolean,
  months_total integer, period_days integer,
  manual_group_id uuid, focus text, platform text, status text,
  budget text, history_count integer, traffic_note_count integer,
  labels jsonb, traffic_group_id uuid
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego acessam o quadro de Tráfego.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  with hist as (
    select company_id, count(*)::int as n from traffic_audit group by company_id
  ),
  tnotes as (
    select n.company_id, count(*)::int as n
    from company_notes n
    join company_note_areas a on a.note_id = n.id and a.area = 'trafego'
    group by n.company_id
  ),
  lbl as (
    select cel.company_id,
      jsonb_agg(
        jsonb_build_object(
          'id', l.id, 'name', l.name, 'bg_color', l.bg_color,
          'text_color', l.text_color, 'highlight', l.highlight
        )
        order by l.highlight desc, l.name
      ) as items
    from company_effective_labels cel
    join labels l on l.id = cel.label_id
    group by cel.company_id
  )
  select
    c.id, c.name, c.group_id,
    exists (
      select 1 from company_contracted_channels x
       where x.company_id = c.id
         and x.channel in ('mercado_livre', 'shopee', 'amazon')
    ) as synced,
    cd.months_total, cd.period_days,
    ct.manual_group_id, ct.focus::text, ct.platform::text, ct.status::text,
    ct.budget::text, coalesce(h.n, 0), coalesce(tn.n, 0),
    coalesce(lbl.items, '[]'::jsonb),
    -- Grupo do Tráfego RESOLVIDO (helper único, agora no banco p/ dispensar
    -- company_groups do lado do gestor).
    case
      when exists (
        select 1 from company_contracted_channels x
         where x.company_id = c.id and x.channel in ('mercado_livre', 'shopee', 'amazon')
      ) then cg.traffic_group_id
      else coalesce(ct.manual_group_id, cg.traffic_group_id)
    end
  from companies c
  left join company_details d on d.company_id = c.id
  left join lateral contract_duration(d.started_on, d.ends_on) cd on true
  left join company_traffic ct on ct.company_id = c.id
  left join company_groups cg on cg.id = c.group_id
  left join hist h on h.company_id = c.id
  left join tnotes tn on tn.company_id = c.id
  left join lbl on lbl.company_id = c.id
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id and cc.channel = 'trafego'
  )
  order by c.name;
end;
$$;

grant execute on function public.traffic_board() to authenticated;

-- ---------------------------------------------------------------------
-- 15) RPCs de edição/movimento: admin E gestor (mesmas validações). Só troca o
--     guard de is_admin() por (is_admin() OR gestor).
-- ---------------------------------------------------------------------
create or replace function traffic_set_focus(p_company_id uuid, p_value traffic_focus)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, focus, updated_at, updated_by)
  values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update
    set focus = excluded.focus, updated_at = now(), updated_by = auth.uid();
end; $$;

create or replace function traffic_set_platform(p_company_id uuid, p_value traffic_platform)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, platform, updated_at, updated_by)
  values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update
    set platform = excluded.platform, updated_at = now(), updated_by = auth.uid();
end; $$;

create or replace function traffic_set_status(p_company_id uuid, p_value traffic_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, status, updated_at, updated_by)
  values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update
    set status = excluded.status, updated_at = now(), updated_by = auth.uid();
end; $$;

create or replace function traffic_set_budget(p_company_id uuid, p_budget text)
returns void language plpgsql security definer set search_path = public as $$
declare v_budget numeric(14,2);
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  if p_budget is not null then
    if btrim(p_budget) !~ '^\d+(\.\d{1,2})?$' then
      raise exception 'Orçamento inválido.' using errcode = 'check_violation';
    end if;
    v_budget := btrim(p_budget)::numeric(14,2);
    if v_budget < 0 then
      raise exception 'O orçamento não pode ser negativo.' using errcode = 'check_violation';
    end if;
  end if;
  insert into company_traffic (company_id, budget, updated_at, updated_by)
  values (p_company_id, v_budget, now(), auth.uid())
  on conflict (company_id) do update
    set budget = excluded.budget, updated_at = now(), updated_by = auth.uid();
end; $$;

create or replace function traffic_move_company(p_company_id uuid, p_traffic_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  if traffic_is_synced(p_company_id) then
    raise exception 'Esta empresa acompanha o quadro de Empresas. Mova por lá.'
      using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, manual_group_id, updated_at, updated_by)
  values (p_company_id, p_traffic_group_id, now(), auth.uid())
  on conflict (company_id) do update
    set manual_group_id = excluded.manual_group_id, updated_at = now(), updated_by = auth.uid();
end; $$;

-- ---------------------------------------------------------------------
-- 16) Menções — novo contexto 'atualizacao_trafego' (painel do Tráfego) lista
--     admins + consultores/colaboradores que alcançam + gestores. No 'atualizacao'
--     comum o gestor NÃO aparece. E, no servidor, menção a gestor só vale se a
--     nota tiver a área 'trafego' (não confiar na tela).
-- ---------------------------------------------------------------------
create or replace function public.mentionable_users(p_source_type text, p_company uuid)
returns table(id uuid, full_name text, avatar_path text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(auth.uid()) then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p
      where p.role in ('admin', 'consultor', 'colaborador', 'gestor_trafego') order by p.full_name;
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
      where p.role = 'admin'
         or p.role = 'gestor_trafego'
         or exists (select 1 from company_consultants c where c.company_id = p_company and c.consultant_id = p.id)
         or exists (select 1 from task_instances t where t.company_id = p_company and t.collaborator_id = p.id)
      order by p.full_name;
  elsif p_source_type in ('cs_note', 'cs_note_reply') then
    if not is_admin() then return; end if;
    return query select p.id, p.full_name, p.avatar_path from profiles p
      where p.role = 'admin' order by p.full_name;
  end if;
end;
$function$;

create or replace function public.sync_content_mentions(p_source_type text, p_source_id uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_caller uuid := auth.uid();
  v_company uuid;
  v_valid uuid[];
  v_is_cs boolean := false;
  v_note uuid;  -- nota de contexto (para a regra do gestor nas Atualizações)
begin
  if p_source_type = 'atualizacao' then
    select company_id into v_company from company_notes where id = p_source_id;
    if v_company is null then return; end if;
    v_note := p_source_id;
  elsif p_source_type = 'atualizacao_resposta' then
    select n.company_id, n.id into v_company, v_note
      from company_note_replies r join company_notes n on n.id = r.note_id where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'cs_note' then
    v_is_cs := true;
    select company_id into v_company from cs_notes where id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'cs_note_reply' then
    v_is_cs := true;
    select n.company_id into v_company from cs_note_replies r join cs_notes n on n.id = r.note_id where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    v_company := null;
  else
    raise exception 'source_type invalido: %', p_source_type;
  end if;

  -- Acesso do CALLER ao contexto.
  if v_is_cs then
    if not is_admin() then raise exception 'sem acesso ao contexto'; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(v_caller) then raise exception 'sem acesso ao contexto'; end if;
  else
    if not user_reaches_company(v_caller, v_company) then raise exception 'sem acesso ao contexto'; end if;
  end if;

  -- Menções VÁLIDAS. Nas Atualizações, um GESTOR DE TRÁFEGO só é válido se a nota
  -- tiver a área 'trafego' (garantia de servidor); os demais, por alcance.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_valid
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where case
    when v_is_cs then (select role from profiles where id = u) = 'admin'
    when p_source_type in ('chamado', 'chamado_resposta') then is_internal_user(u)
    when (select role from profiles where id = u) = 'gestor_trafego' then
      exists (select 1 from company_note_areas a where a.note_id = v_note and a.area = 'trafego')
    else user_reaches_company(u, v_company)
  end;

  delete from content_mentions
  where source_type = p_source_type and source_id = p_source_id
    and not (mentioned_user_id = any (v_valid));

  insert into content_mentions (mentioned_user_id, author_id, source_type, source_id, company_id)
  select u, v_caller, p_source_type, p_source_id, v_company from unnest(v_valid) as u
  on conflict (source_type, source_id, mentioned_user_id) do nothing;
end;
$function$;
