-- =====================================================================
-- 0109 — Quadro "Tráfego" (Fatia 2): colunas editáveis, movimento manual e
-- histórico próprio.
-- =====================================================================
-- A Fatia 1 (0108) montou a VISÃO: grupos próprios (traffic_groups),
-- correspondência Empresas→Tráfego (company_groups.traffic_group_id), o modo
-- CALCULADO (synced = tem 'trafego' E algum marketplace) e traffic_board().
--
-- Esta fatia acrescenta DADOS PRÓPRIOS do Tráfego por empresa (company_traffic):
-- Foco, Plataforma, Status, Orçamento e o grupo escolhido À MÃO (manual_group_id,
-- só vale quando a empresa é MANUAL). Tudo admin-only — a Fatia 4 (Gestor de
-- Tráfego) vai AMPLIAR as policies e o is_admin() das RPCs; nada aqui prende a
-- "só admin" fora desses pontos.
--
-- Nada do Tráfego vai para company_events NEM para cs_audit: company_traffic não
-- tem gatilho de evento e seu histórico mora em traffic_audit (tabela própria).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Enums das colunas (valores internos em snake_case; os rótulos e as cores
--    moram no front — lib/traffic-options.ts — como em cs-status.ts).
-- ---------------------------------------------------------------------
create type traffic_focus as enum (
  'vendas',           -- "Vendas"
  'whatsapp',         -- "WhatsApp"
  'whatsapp_vendas',  -- "WhatsApp + Vendas"
  'negocio_local'     -- "Negócio Local"
);

create type traffic_platform as enum (
  'nao_iniciado',  -- "Não Iniciado"
  'meta',          -- "Meta"
  'google',        -- "Google"
  'google_meta',   -- "Google + Meta"
  'bagy'           -- "Bagy"
);

create type traffic_status as enum (
  'pausado',             -- "Pausado"
  'aguardando_conteudo', -- "Aguardando Conteúdo"
  'primeira_campanha',   -- "Primeira Campanha"
  'campanha_validada',   -- "Campanha Validada"
  'projeto_entregue'     -- "Projeto Entregue"
);

-- ---------------------------------------------------------------------
-- 2) Dados do Tráfego por empresa. UMA linha por empresa; todos os campos
--    opcionais (nulo = "Não definido"). manual_group_id é o grupo escolhido À
--    MÃO (só vale no modo manual; nas sincronizadas é ignorado pelo helper).
--    Os dados ficam guardados mesmo quando a empresa SAI do quadro (tira
--    'trafego'); se voltar, reaparecem — por isso nada aqui é apagado na saída.
--    updated_by é uuid SEM FK de propósito (igual ao CS): não pode quebrar se um
--    perfil for removido; o nome é resolvido ao vivo (display_profiles).
-- ---------------------------------------------------------------------
create table company_traffic (
  company_id      uuid primary key references companies(id) on delete cascade,
  manual_group_id uuid references traffic_groups(id) on delete set null,
  focus           traffic_focus,
  platform        traffic_platform,
  status          traffic_status,
  budget          numeric(14,2) check (budget is null or budget >= 0),
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

-- ---------------------------------------------------------------------
-- 3) Histórico (append-only), no mesmo molde do cs_audit (0104): genérico por
--    `field`, um registro por campo alterado, nada quando o valor não muda.
--    changed_by nulo = "Sistema". NENHUMA policy de insert/update/delete — só o
--    gatilho (definer) escreve.
--      field ∈ ('grupo_manual','foco','plataforma','status','orcamento')
--      grupo_manual: old/new guardam o NOME do grupo no momento (self-contained).
--      foco/plataforma/status: guardam o valor do enum (texto); rótulo no front.
--      orcamento: guarda o numeric como texto (formatado em BRL no front).
-- ---------------------------------------------------------------------
create table traffic_audit (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  field      text not null,
  old_value  text,
  new_value  text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index traffic_audit_company_idx on traffic_audit (company_id, changed_at desc, id desc);

-- ---------------------------------------------------------------------
-- 4) RLS — admin-only (a Fatia 4 amplia para o Gestor de Tráfego). traffic_audit
--    é APPEND-ONLY: só SELECT; sem policy de escrita (quem grava é o gatilho).
-- ---------------------------------------------------------------------
alter table company_traffic enable row level security;
alter table traffic_audit enable row level security;

create policy company_traffic_all on company_traffic
  for all using ((select is_admin())) with check ((select is_admin()));
create policy traffic_audit_select on traffic_audit
  for select using ((select is_admin()));

-- ---------------------------------------------------------------------
-- 5) Gatilho de auditoria (AFTER, SECURITY DEFINER). Um registro por campo;
--    UPDATE que não muda o valor não registra. GUARD de cascade reaproveitando
--    company_exists() (0079): na exclusão da empresa a cascata apaga esta linha e
--    o gatilho sairia tentando gravar num company_id já removido (a FK recusaria).
--
--    changed_by = auth.uid(), EXCETO quando a GUC app.traffic_system está ligada
--    (a limpeza automática do grupo manual pelo gatilho de canais) → changed_by
--    nulo, que o front mostra como "Sistema".
-- ---------------------------------------------------------------------
create or replace function company_traffic_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := case
    when current_setting('app.traffic_system', true) = 'on' then null
    else auth.uid()
  end;
begin
  if tg_op = 'INSERT' then
    if new.manual_group_id is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'grupo_manual', null,
              (select name from traffic_groups where id = new.manual_group_id), v_actor);
    end if;
    if new.focus is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'foco', null, new.focus::text, v_actor);
    end if;
    if new.platform is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'plataforma', null, new.platform::text, v_actor);
    end if;
    if new.status is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'status', null, new.status::text, v_actor);
    end if;
    if new.budget is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'orcamento', null, new.budget::text, v_actor);
    end if;
    return null;

  elsif tg_op = 'UPDATE' then
    if new.manual_group_id is distinct from old.manual_group_id then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'grupo_manual',
              (select name from traffic_groups where id = old.manual_group_id),
              (select name from traffic_groups where id = new.manual_group_id), v_actor);
    end if;
    if new.focus is distinct from old.focus then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'foco', old.focus::text, new.focus::text, v_actor);
    end if;
    if new.platform is distinct from old.platform then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'plataforma', old.platform::text, new.platform::text, v_actor);
    end if;
    if new.status is distinct from old.status then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'status', old.status::text, new.status::text, v_actor);
    end if;
    if new.budget is distinct from old.budget then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (new.company_id, 'orcamento', old.budget::text, new.budget::text, v_actor);
    end if;
    return null;

  else -- DELETE (na prática só via cascade da exclusão da empresa)
    if not company_exists(old.company_id) then
      return null; -- cascade da exclusão da empresa: nada a gravar
    end if;
    if old.manual_group_id is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'grupo_manual',
              (select name from traffic_groups where id = old.manual_group_id), null, v_actor);
    end if;
    if old.focus is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'foco', old.focus::text, null, v_actor);
    end if;
    if old.platform is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'plataforma', old.platform::text, null, v_actor);
    end if;
    if old.status is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'status', old.status::text, null, v_actor);
    end if;
    if old.budget is not null then
      insert into traffic_audit (company_id, field, old_value, new_value, changed_by)
      values (old.company_id, 'orcamento', old.budget::text, null, v_actor);
    end if;
    return null;
  end if;
end;
$$;

create trigger company_traffic_audit_trg
  after insert or update or delete on company_traffic
  for each row execute function company_traffic_audit();

-- ---------------------------------------------------------------------
-- 6) RPCs de escrita (SECURITY INVOKER; a RLS admin-only das tabelas é a barreira
--    real + o guard explícito). Cada uma começa recusando não-admin e recusa
--    empresa que não está no quadro (sem 'trafego'). Um comando de escrita cada.
-- ---------------------------------------------------------------------

-- Helper interno: a empresa está no quadro (contratou 'trafego')? SECURITY INVOKER
-- de propósito — roda sob a RLS de quem chama; company_contracted_channels é
-- legível pelo admin. STABLE.
create or replace function traffic_on_board(p_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id and channel = 'trafego'
  )
$$;

-- A empresa é SINCRONIZADA? (tem 'trafego' E algum marketplace) — MESMA regra do
-- modo calculado, agora no banco para o move recusar corretamente.
create or replace function traffic_is_synced(p_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id and channel = 'trafego'
  ) and exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id
       and channel in ('mercado_livre', 'shopee', 'amazon')
  )
$$;

create or replace function traffic_set_focus(p_company_id uuid, p_value traffic_focus)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, focus, updated_at, updated_by)
  values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update
    set focus = excluded.focus, updated_at = now(), updated_by = auth.uid();
end;
$$;

create or replace function traffic_set_platform(p_company_id uuid, p_value traffic_platform)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, platform, updated_at, updated_by)
  values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update
    set platform = excluded.platform, updated_at = now(), updated_by = auth.uid();
end;
$$;

create or replace function traffic_set_status(p_company_id uuid, p_value traffic_status)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  if not traffic_on_board(p_company_id) then
    raise exception 'Esta empresa não está no quadro de Tráfego.' using errcode = 'check_violation';
  end if;
  insert into company_traffic (company_id, status, updated_at, updated_by)
  values (p_company_id, p_value, now(), auth.uid())
  on conflict (company_id) do update
    set status = excluded.status, updated_at = now(), updated_by = auth.uid();
end;
$$;

-- Orçamento: texto decimal "digits.dd" (o front converte o BR → decimal, nunca
-- float); null = limpar. '-10' e textos inválidos recusados pelo regex (e o CHECK
-- da tabela é a segunda barreira).
create or replace function traffic_set_budget(p_company_id uuid, p_budget text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_budget numeric(14,2);
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o Tráfego.' using errcode = 'insufficient_privilege';
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
end;
$$;

-- Mover: só empresas MANUAIS. Recusa fora do quadro e recusa SINCRONIZADA (com a
-- mensagem exata). p_traffic_group_id nulo é aceito (volta a seguir a
-- correspondência de Empresas), mas a tela só oferece grupos reais.
create or replace function traffic_move_company(p_company_id uuid, p_traffic_group_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores alteram o Tráfego.' using errcode = 'insufficient_privilege';
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
end;
$$;

grant execute on function traffic_on_board(uuid) to authenticated;
grant execute on function traffic_is_synced(uuid) to authenticated;
grant execute on function traffic_set_focus(uuid, traffic_focus) to authenticated;
grant execute on function traffic_set_platform(uuid, traffic_platform) to authenticated;
grant execute on function traffic_set_status(uuid, traffic_status) to authenticated;
grant execute on function traffic_set_budget(uuid, text) to authenticated;
grant execute on function traffic_move_company(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Gatilho em company_contracted_channels (AFTER INSERT/DELETE, POR COMANDO):
--    quando uma empresa PASSA a ser sincronizada, zera company_traffic
--    .manual_group_id dela — assim, se voltar a manual, recomeça do grupo
--    correspondente de Empresas, sem escolha antiga obsoleta. A limpeza entra no
--    histórico como "Sistema" (GUC app.traffic_system ligada durante o UPDATE).
--    Idempotente: só mexe em quem está sincronizada E tem manual_group_id.
-- ---------------------------------------------------------------------
create or replace function traffic_clear_manual_for(p_companies uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(array_length(p_companies, 1), 0) = 0 then
    return;
  end if;
  perform set_config('app.traffic_system', 'on', true);
  update company_traffic ct
     set manual_group_id = null, updated_at = now(), updated_by = null
   where ct.manual_group_id is not null
     and ct.company_id = any (p_companies)
     and exists (
       select 1 from company_contracted_channels x
        where x.company_id = ct.company_id and x.channel = 'trafego')
     and exists (
       select 1 from company_contracted_channels y
        where y.company_id = ct.company_id
          and y.channel in ('mercado_livre', 'shopee', 'amazon'));
  perform set_config('app.traffic_system', 'off', true);
end;
$$;

create or replace function traffic_channels_sync_ins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform traffic_clear_manual_for(array(select distinct company_id from inserted));
  return null;
end;
$$;

create or replace function traffic_channels_sync_del()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Tirar canais nunca TORNA sincronizada; o guard em traffic_clear_manual_for
  -- garante que nada é limpo à toa. Mantido por simetria com a especificação.
  perform traffic_clear_manual_for(array(select distinct company_id from deleted));
  return null;
end;
$$;

create trigger traffic_channels_sync_ins_trg
  after insert on company_contracted_channels
  referencing new table as inserted
  for each statement execute function traffic_channels_sync_ins();

create trigger traffic_channels_sync_del_trg
  after delete on company_contracted_channels
  referencing old table as deleted
  for each statement execute function traffic_channels_sync_del();

-- ---------------------------------------------------------------------
-- 8) traffic_board() — novo retorno: acrescenta manual_group_id, focus, platform,
--    status, budget (texto) e history_count. Mudança de tipo de retorno exige
--    DROP + CREATE (conferir em pg_proc que sobra UMA assinatura).
-- ---------------------------------------------------------------------
drop function if exists public.traffic_board();

create function public.traffic_board()
returns table (
  id uuid,
  name text,
  group_id uuid,
  synced boolean,
  months_total integer,
  period_days integer,
  manual_group_id uuid,
  focus text,
  platform text,
  status text,
  budget text,
  history_count integer
)
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with hist as (
    select company_id, count(*)::int as n from traffic_audit group by company_id
  )
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
    cd.period_days,
    ct.manual_group_id,
    ct.focus::text,
    ct.platform::text,
    ct.status::text,
    ct.budget::text,
    coalesce(h.n, 0)
  from companies c
  left join company_details d on d.company_id = c.id
  left join lateral contract_duration(d.started_on, d.ends_on) cd on true
  left join company_traffic ct on ct.company_id = c.id
  left join hist h on h.company_id = c.id
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id and cc.channel = 'trafego'
  )
  order by c.name;
end;
$$;

grant execute on function public.traffic_board() to authenticated;
