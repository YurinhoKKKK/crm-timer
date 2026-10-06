-- Quadro "Sucesso do Cliente" (CS) — FATIA 2: NPS (geral + por pessoa), Data da
-- Reunião e histórico próprio do CS. Tudo admin-only; o NPS NÃO aparece em
-- company_events, nem em nenhuma tela de consultor/colaborador/portal.
--
-- Independência: NPS geral e grupo da empresa são independentes — marcar churn
-- NÃO move de grupo, e mover de grupo NÃO altera o NPS. Nenhuma automação.

-- ---------------------------------------------------------------------------
-- 1) Enum de status
-- ---------------------------------------------------------------------------
create type cs_nps_status as enum (
  'promotor',
  'neutro',
  'detrator',
  'churn_erro_operacional',
  'churn_projeto_finalizado'
);

-- ---------------------------------------------------------------------------
-- 2) Tabelas
-- ---------------------------------------------------------------------------

-- Status por empresa: NPS geral (5 opções) + data da reunião. UMA linha por
-- empresa (os dois campos convivem). Nenhum é obrigatório.
create table cs_company_status (
  company_id uuid primary key references companies(id) on delete cascade,
  nps_status cs_nps_status,
  meeting_on date,
  updated_at timestamptz not null default now(),
  -- Atores (updated_by/changed_by/subject) são uuid SEM FK de propósito: o
  -- histórico é append-only e não pode quebrar nem sumir se um perfil for
  -- removido; o nome é resolvido ao vivo (display_profiles).
  updated_by uuid
);

-- NPS individual: só promotor/neutro/detrator (churn é desfecho da EMPRESA, não
-- da pessoa) — CHECK no banco, não só na tela. user_id espelha o consultor de
-- company_consultants: FK profiles ON DELETE CASCADE.
create table cs_person_nps (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status cs_nps_status not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (company_id, user_id),
  constraint cs_person_nps_status_chk
    check (status in ('promotor', 'neutro', 'detrator'))
);

-- Histórico (append-only). GENÉRICO (field): nesta fatia 'nps_geral',
-- 'nps_pessoa', 'data_reuniao'; a fatia 3 acrescenta outros sem mudar o schema.
create table cs_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  subject_user_id uuid,            -- preenchido só quando é NPS de pessoa
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index cs_audit_company_idx on cs_audit (company_id, changed_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 3) RLS — admin-only. cs_audit é APPEND-ONLY: só SELECT (admin); nenhuma
--    policy de insert/update/delete — quem escreve é o gatilho (definer).
-- ---------------------------------------------------------------------------
alter table cs_company_status enable row level security;
alter table cs_person_nps enable row level security;
alter table cs_audit enable row level security;

create policy cs_company_status_all on cs_company_status
  for all using ((select is_admin())) with check ((select is_admin()));
create policy cs_person_nps_all on cs_person_nps
  for all using ((select is_admin())) with check ((select is_admin()));
create policy cs_audit_select on cs_audit
  for select using ((select is_admin()));

-- ---------------------------------------------------------------------------
-- 4) Gatilhos de auditoria (AFTER, SECURITY DEFINER). Um registro por campo
--    alterado; UPDATE que não muda o valor não registra. changed_by = auth.uid().
--    GUARD de cascade: reaproveita company_exists() (migration 0079) — na
--    exclusão da empresa, a cascata apaga estas linhas e o gatilho tentaria
--    gravar em cs_audit apontando para a empresa já removida (a FK recusaria);
--    o guard sai sem gravar (o CASCADE já leva o histórico junto).
-- ---------------------------------------------------------------------------
create or replace function cs_company_status_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.nps_status is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'nps_geral', null, new.nps_status::text, auth.uid());
    end if;
    if new.meeting_on is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'data_reuniao', null,
              to_char(new.meeting_on, 'YYYY-MM-DD'), auth.uid());
    end if;
    return null;
  elsif tg_op = 'UPDATE' then
    if new.nps_status is distinct from old.nps_status then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'nps_geral',
              old.nps_status::text, new.nps_status::text, auth.uid());
    end if;
    if new.meeting_on is distinct from old.meeting_on then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'data_reuniao',
              to_char(old.meeting_on, 'YYYY-MM-DD'),
              to_char(new.meeting_on, 'YYYY-MM-DD'), auth.uid());
    end if;
    return null;
  else -- DELETE
    if not company_exists(old.company_id) then
      return null; -- cascade da exclusão da empresa: nada a gravar
    end if;
    if old.nps_status is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'nps_geral', old.nps_status::text, null, auth.uid());
    end if;
    if old.meeting_on is not null then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'data_reuniao',
              to_char(old.meeting_on, 'YYYY-MM-DD'), null, auth.uid());
    end if;
    return null;
  end if;
end;
$$;

create trigger cs_company_status_audit_trg
  after insert or update or delete on cs_company_status
  for each row execute function cs_company_status_audit();

create or replace function cs_person_nps_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into cs_audit (company_id, subject_user_id, field, old_value, new_value, changed_by)
    values (new.company_id, new.user_id, 'nps_pessoa', null, new.status::text, auth.uid());
    return null;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into cs_audit (company_id, subject_user_id, field, old_value, new_value, changed_by)
      values (new.company_id, new.user_id, 'nps_pessoa',
              old.status::text, new.status::text, auth.uid());
    end if;
    return null;
  else -- DELETE (limpar o NPS da pessoa, ou cascade da empresa)
    if not company_exists(old.company_id) then
      return null;
    end if;
    insert into cs_audit (company_id, subject_user_id, field, old_value, new_value, changed_by)
    values (old.company_id, old.user_id, 'nps_pessoa', old.status::text, null, auth.uid());
    return null;
  end if;
end;
$$;

create trigger cs_person_nps_audit_trg
  after insert or update or delete on cs_person_nps
  for each row execute function cs_person_nps_audit();

-- ---------------------------------------------------------------------------
-- 5) RPCs de escrita (SECURITY INVOKER; a RLS admin-only das tabelas é a
--    barreira real + o guard explícito). Upsert de UM comando, sem laço.
-- ---------------------------------------------------------------------------
create or replace function cs_set_company_nps(p_company_id uuid, p_status cs_nps_status)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o NPS.' using errcode = 'insufficient_privilege';
  end if;
  insert into cs_company_status (company_id, nps_status, updated_at, updated_by)
  values (p_company_id, p_status, now(), auth.uid())
  on conflict (company_id) do update
    set nps_status = excluded.nps_status, updated_at = now(), updated_by = auth.uid();
end;
$$;

create or replace function cs_set_meeting_on(p_company_id uuid, p_date date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram a data da reunião.' using errcode = 'insufficient_privilege';
  end if;
  insert into cs_company_status (company_id, meeting_on, updated_at, updated_by)
  values (p_company_id, p_date, now(), auth.uid())
  on conflict (company_id) do update
    set meeting_on = excluded.meeting_on, updated_at = now(), updated_by = auth.uid();
end;
$$;

create or replace function cs_set_person_nps(p_company_id uuid, p_user_id uuid, p_status cs_nps_status)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o NPS.' using errcode = 'insufficient_privilege';
  end if;

  -- null = limpar: apaga a linha (o histórico registra a limpeza pelo gatilho).
  if p_status is null then
    delete from cs_person_nps where company_id = p_company_id and user_id = p_user_id;
    return;
  end if;

  -- Só avalia quem é consultor OU colaborador ATUAL da empresa.
  if not exists (
    select 1 from company_consultants
    where company_id = p_company_id and consultant_id = p_user_id
    union all
    select 1 from company_collaborators
    where company_id = p_company_id and collaborator_id = p_user_id
  ) then
    raise exception 'Só é possível avaliar quem é consultor ou colaborador atual da empresa.'
      using errcode = 'check_violation';
  end if;

  -- O CHECK da tabela recusa churn_* aqui (NPS de pessoa é só promotor/neutro/detrator).
  insert into cs_person_nps (company_id, user_id, status, updated_at, updated_by)
  values (p_company_id, p_user_id, p_status, now(), auth.uid())
  on conflict (company_id, user_id) do update
    set status = excluded.status, updated_at = now(), updated_by = auth.uid();
end;
$$;

grant execute on function cs_set_company_nps(uuid, cs_nps_status) to authenticated;
grant execute on function cs_set_meeting_on(uuid, date) to authenticated;
grant execute on function cs_set_person_nps(uuid, uuid, cs_nps_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) cs_board() — novo retorno (nps_status, meeting_on, e status/papel em cada
--    responsável). Mudança de tipo de retorno exige DROP + CREATE.
-- ---------------------------------------------------------------------------
drop function if exists public.cs_board();

create function public.cs_board()
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
  nps_status text,
  meeting_on text,
  responsibles jsonb
)
language plpgsql
security invoker
set search_path to 'public'
as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Sucesso do Cliente.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with resp as (
    select company_id, consultant_id as user_id, true as is_cons, false as is_colab
    from company_consultants
    union all
    select company_id, collaborator_id as user_id, false, true
    from company_collaborators
  ),
  resp_roles as (
    -- Pessoa que é consultor E colaborador na mesma empresa aparece UMA vez.
    select r.company_id, r.user_id,
           bool_or(r.is_cons) as is_cons,
           bool_or(r.is_colab) as is_colab
    from resp r
    group by r.company_id, r.user_id
  ),
  resp_json as (
    select rr.company_id,
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', coalesce(nullif(p.full_name, ''), p.email),
          'role', case
                    when rr.is_cons and rr.is_colab then 'ambos'
                    when rr.is_cons then 'consultor'
                    else 'colaborador'
                  end,
          'status', pn.status
        )
        -- Consultores (inclui quem é "ambos") primeiro; depois colaboradores; por nome.
        order by (case when rr.is_cons then 0 else 1 end),
                 coalesce(nullif(p.full_name, ''), p.email)
      ) as items
    from resp_roles rr
    join profiles p on p.id = rr.user_id
    left join cs_person_nps pn
      on pn.company_id = rr.company_id and pn.user_id = rr.user_id
    group by rr.company_id
  )
  select
    c.id,
    c.name,
    c.group_id,
    to_char(d.started_on, 'YYYY-MM-DD'),
    case
      when v.project_value is not null and v.installments is not null and v.installments <> 0
      then round(v.project_value / v.installments, 2)::text
      else null
    end,
    v.project_value::text,
    v.installments,
    case
      when d.started_on is not null and d.ends_on is not null
      then (extract(year from age(d.ends_on, d.started_on)) * 12
            + extract(month from age(d.ends_on, d.started_on)))::int
      else null
    end,
    case
      when d.started_on is not null and d.ends_on is not null
      then extract(day from age(d.ends_on, d.started_on))::int
      else null
    end,
    s.nps_status::text,
    to_char(s.meeting_on, 'YYYY-MM-DD'),
    coalesce(rj.items, '[]'::jsonb)
  from companies c
  left join company_details d on d.company_id = c.id
  left join company_contract_values v on v.company_id = c.id
  left join cs_company_status s on s.company_id = c.id
  left join resp_json rj on rj.company_id = c.id
  order by c.name;
end;
$fn$;

grant execute on function public.cs_board() to authenticated;
