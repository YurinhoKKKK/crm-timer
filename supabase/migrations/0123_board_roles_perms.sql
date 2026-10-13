-- =====================================================================
-- Quadros de área (Desenvolvimento e Tráfego): mensagens de permissão neutras e
-- leitura do Desenvolvedor restrita ao alcance (como o Gestor de Tráfego).
-- =====================================================================
-- Contexto: o cargo 'desenvolvedor' já pode gerir o quadro de Desenvolvimento no
-- banco (dev_can_manage()), e o 'gestor_trafego' o de Tráfego. Esta migration só
-- alinha duas pontas:
--  1) As mensagens de recusa das RPCs dos dois quadros deixam de citar cargo
--     ("Apenas administradores ...") e passam ao texto neutro
--     "Você não tem permissão para alterar o quadro de {Desenvolvimento|Tráfego}.".
--  2) As policies de LEITURA do Desenvolvedor passam a ter o MESMO recorte do
--     Gestor de Tráfego: só as empresas do quadro dele (my_dev_companies()).
--     Antes company_dev_dev_select / dev_audit_select / dev_clock_periods_select
--     liberavam para QUALQUER empresa. dev_groups_select continua inteiro (são só
--     os nomes dos grupos). A regra de GESTÃO (dev_can_manage) não muda.
--
-- Corpos das RPCs idênticos aos atuais — só a mensagem de erro muda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Desenvolvimento — RPCs (mensagem neutra)
-- ---------------------------------------------------------------------
create or replace function public.dev_set_status(p_company_id uuid, p_status dev_status)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lista         uuid;
  v_current_group uuid;
  v_target_group  uuid;
begin
  if not dev_can_manage() then
    raise exception 'Você não tem permissão para alterar o quadro de Desenvolvimento.' using errcode = 'insufficient_privilege';
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
$function$;

create or replace function public.dev_move_company(p_company_id uuid, p_dev_group_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status dev_status;
begin
  if not dev_can_manage() then
    raise exception 'Você não tem permissão para alterar o quadro de Desenvolvimento.' using errcode = 'insufficient_privilege';
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
$function$;

create or replace function public.dev_pause_deadline(p_company_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not dev_can_manage() then
    raise exception 'Você não tem permissão para alterar o quadro de Desenvolvimento.' using errcode = 'insufficient_privilege';
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
$function$;

create or replace function public.dev_resume_deadline(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not dev_can_manage() then
    raise exception 'Você não tem permissão para alterar o quadro de Desenvolvimento.' using errcode = 'insufficient_privilege';
  end if;
  if not dev_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Desenvolvimento.' using errcode = 'check_violation';
  end if;

  update company_dev
     set manual_paused = false, pause_reason = null, paused_at = null, paused_by = null,
         updated_at = now(), updated_by = auth.uid()
   where company_id = p_company_id and manual_paused = true;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2) Tráfego — RPCs (mensagem neutra; sem citar cargo)
-- ---------------------------------------------------------------------
create or replace function public.traffic_set_focus(p_company_id uuid, p_value traffic_focus)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Você não tem permissão para alterar o quadro de Tráfego.' using errcode = 'insufficient_privilege'; end if;
  if not traffic_on_board(p_company_id) then raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation'; end if;
  insert into company_traffic (company_id, focus, updated_at, updated_by) values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update set focus = excluded.focus, updated_at = now(), updated_by = auth.uid();
end; $function$;

create or replace function public.traffic_set_platform(p_company_id uuid, p_value traffic_platform)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Você não tem permissão para alterar o quadro de Tráfego.' using errcode = 'insufficient_privilege'; end if;
  if not traffic_on_board(p_company_id) then raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation'; end if;
  insert into company_traffic (company_id, platform, updated_at, updated_by) values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update set platform = excluded.platform, updated_at = now(), updated_by = auth.uid();
end; $function$;

create or replace function public.traffic_set_status(p_company_id uuid, p_value traffic_status)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Você não tem permissão para alterar o quadro de Tráfego.' using errcode = 'insufficient_privilege'; end if;
  if not traffic_on_board(p_company_id) then raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation'; end if;
  insert into company_traffic (company_id, status, updated_at, updated_by) values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update set status = excluded.status, updated_at = now(), updated_by = auth.uid();
end; $function$;

create or replace function public.traffic_set_budget(p_company_id uuid, p_budget text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_budget numeric(14,2);
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Você não tem permissão para alterar o quadro de Tráfego.' using errcode = 'insufficient_privilege'; end if;
  if not traffic_on_board(p_company_id) then raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation'; end if;
  if p_budget is not null then
    if btrim(p_budget) !~ '^\d+(\.\d{1,2})?$' then raise exception 'Orçamento inválido.' using errcode = 'check_violation'; end if;
    v_budget := btrim(p_budget)::numeric(14,2);
    if v_budget < 0 then raise exception 'O orçamento não pode ser negativo.' using errcode = 'check_violation'; end if;
  end if;
  insert into company_traffic (company_id, budget, updated_at, updated_by) values (p_company_id, v_budget, now(), auth.uid())
  on conflict (company_id) do update set budget = excluded.budget, updated_at = now(), updated_by = auth.uid();
end; $function$;

create or replace function public.traffic_move_company(p_company_id uuid, p_traffic_group_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Você não tem permissão para alterar o quadro de Tráfego.' using errcode = 'insufficient_privilege'; end if;
  if not traffic_on_board(p_company_id) then raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation'; end if;
  if traffic_is_synced(p_company_id) then raise exception 'Esta empresa acompanha o quadro de Empresas. Mova por lá.' using errcode = 'check_violation'; end if;
  insert into company_traffic (company_id, manual_group_id, updated_at, updated_by) values (p_company_id, p_traffic_group_id, now(), auth.uid())
  on conflict (company_id) do update set manual_group_id = excluded.manual_group_id, updated_at = now(), updated_by = auth.uid();
end; $function$;

-- ---------------------------------------------------------------------
-- 3) Desenvolvimento — leitura do Desenvolvedor restrita ao alcance
--    (mesmo recorte do Gestor de Tráfego: company_id IN my_dev_companies()).
-- ---------------------------------------------------------------------
alter policy company_dev_dev_select on public.company_dev
using (
  (select auth_role()) = 'desenvolvedor'
  and company_id in (select my_dev_companies())
);

alter policy dev_audit_select on public.dev_audit
using (
  (select is_admin())
  or ((select auth_role()) = 'desenvolvedor' and company_id in (select my_dev_companies()))
);

alter policy dev_clock_periods_select on public.dev_clock_periods
using (
  (select is_admin())
  or ((select auth_role()) = 'desenvolvedor' and company_id in (select my_dev_companies()))
);
