-- =====================================================================
-- CONTROLE DE CHURN — ETAPA 1: CAPTURA
-- =====================================================================
-- "Controle de Churn" é a 2ª aba do quadro Sucesso do Cliente (a aba em si é a
-- ETAPA 2 — aqui só a CAPTURA). Captura = configurar quais grupos de Empresas são
-- de churn, exigir motivo ao cancelar, e registrar uma "foto" do momento em que a
-- empresa entra num grupo de churn (company_churns).
--
-- PRINCÍPIOS (não reabrir):
--  · Grupos de churn são DADO (company_groups.churn_type), semeados POR ID. O
--    código NUNCA identifica churn pelo NOME do grupo.
--  · O MOTIVO (churn_reason) só vive no módulo de churn: nunca em company_events,
--    na central da empresa, no quadro de Empresas, nem em qualquer tela fora do CS.
--  · A garantia do motivo é no BANCO: um gatilho BEFORE em companies recusa a
--    entrada em grupo 'cancelado' sem motivo válido, por QUALQUER caminho
--    (arrastar, lote, Editar empresa, SQL). O motivo chega pela transação via um
--    mapa em GUC (app.churn_reasons), publicado pela RPC set_companies_group.
--  · O evento 'grupo_alterado' (0072) e o fluxo de grupos (0095, paused_by_group /
--    notificações) continuam IDÊNTICOS e SEM o motivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Classificação de churn do grupo (DADO, editável; semeado por ID).
-- ---------------------------------------------------------------------
alter table company_groups
  add column churn_type text
    check (churn_type is null or churn_type in ('finalizado', 'cancelado'));

comment on column company_groups.churn_type is
  'Marca o grupo como de CHURN para o Controle de Churn (quadro CS): '
  'finalizado (Projetos Finalizados) ou cancelado (Cancelados). null = não é '
  'churn. É DADO editável — o código decide por este campo, NUNCA pelo nome.';

-- Semeadura POR ID (jamais pelo nome).
update company_groups set churn_type = 'finalizado'
  where id = '947b8de9-0f85-4eb2-b789-c2b648978d0f';
update company_groups set churn_type = 'cancelado'
  where id = '5d1ff3fa-9802-40a5-85b7-166e3b25b167';

-- ---------------------------------------------------------------------
-- 2. Motivos de churn (enum) + rótulos.
--    'nao_informado' existe SÓ para o preenchimento dos registros antigos; não
--    pode ser escolhido ao mover (o gatilho BEFORE recusa).
-- ---------------------------------------------------------------------
create type churn_reason as enum (
  'erro_consultoria',
  'erro_comercial',
  'erro_gestao_cliente',
  'cliente_demitido',
  'projeto_finalizado',
  'decisao_cliente',
  'nao_informado'
);

create or replace function churn_reason_label(p churn_reason)
returns text
language sql immutable
set search_path = public
as $$
  select case p
    when 'erro_consultoria'    then 'Erro consultoria'
    when 'erro_comercial'      then 'Erro comercial'
    when 'erro_gestao_cliente' then 'Erro gestão cliente'
    when 'cliente_demitido'    then 'Cliente demitido'
    when 'projeto_finalizado'  then 'Projeto finalizado'
    when 'decisao_cliente'     then 'Decisão do cliente'
    when 'nao_informado'       then 'Não informado'
  end;
$$;

grant execute on function churn_reason_label(churn_reason) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Registro de churn — a "foto" do momento. No máximo UM ativo por empresa.
--    Atores (created_by/updated_by/reverted_by) são uuid SEM FK: o registro é
--    histórico e não pode sumir/quebrar se um perfil for removido.
-- ---------------------------------------------------------------------
create table company_churns (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  churn_type   text not null check (churn_type in ('finalizado', 'cancelado')),
  churned_on   date,                         -- data pura (BRT); null = "sem data"
  reason       churn_reason not null,
  seller_name  text,                         -- closer do momento (company_details)
  consultants  jsonb not null default '[]'::jsonb,  -- [{id,name}] do momento
  mrr          numeric(14,2) check (mrr is null or mrr >= 0),
  reverted_at  timestamptz,                  -- preenchido ao sair do churn
  reverted_by  uuid,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

-- No máximo UM registro ativo (reverted_at null) por empresa.
create unique index company_churns_one_active
  on company_churns (company_id) where reverted_at is null;
create index company_churns_company_idx
  on company_churns (company_id, created_at desc);

-- RLS: admin lê; escrita SÓ pelos gatilhos/RPC (SECURITY DEFINER). Nenhuma policy
-- de insert/update/delete — consultor/colaborador nunca leem nem escrevem.
alter table company_churns enable row level security;
create policy company_churns_select on company_churns
  for select using ((select is_admin()));
revoke all on company_churns from anon;

-- ---------------------------------------------------------------------
-- 4. GARANTIA DO MOTIVO (gatilho BEFORE). Entrar num grupo 'cancelado' exige um
--    motivo válido (≠ 'nao_informado') para aquela empresa no mapa app.churn_reasons
--    (publicado pela RPC na mesma transação). Vale para arrastar, lote, Editar
--    empresa e SQL direto. DEFINER para ler company_groups sempre.
-- ---------------------------------------------------------------------
create or replace function companies_churn_reason_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest_churn text;
  v_reasons    jsonb;
  v_reason     text;
begin
  -- UPDATE que não mexeu no grupo: nada a validar.
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id then
    return new;
  end if;

  select churn_type into v_dest_churn from company_groups where id = new.group_id;

  -- Só a ENTRADA em 'cancelado' exige motivo (finalizado é automático).
  if v_dest_churn is distinct from 'cancelado' then
    return new;
  end if;

  v_reasons := nullif(current_setting('app.churn_reasons', true), '')::jsonb;
  v_reason  := v_reasons ->> new.id::text;

  if v_reason is null
     or v_reason not in ('erro_consultoria', 'erro_comercial', 'erro_gestao_cliente',
                         'cliente_demitido', 'projeto_finalizado', 'decisao_cliente') then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_companies_churn_reason_guard on companies;
create trigger trg_companies_churn_reason_guard
  before insert or update of group_id on companies
  for each row execute function companies_churn_reason_guard();

-- ---------------------------------------------------------------------
-- 5. CAPTURA (gatilho AFTER). Cria/reverte o registro-foto conforme a transição,
--    um comando por regra (sem laço). DEFINER + search_path fixo. A proteção de
--    exclusão em cascata (0079: company_exists) evita gravar cs_audit apontando
--    para empresa já removida.
--      · SAIU de churn (origem churn)  -> reverte o ativo.
--      · ENTROU em churn (destino churn) -> cria o registro (foto do momento).
--      · churn -> churn                 -> as duas (reverte + cria novo).
--    cs_audit (field 'churn'): "Projeto finalizado" / "Cliente cancelado: {motivo}"
--    ao entrar; "Churn revertido (voltou para {grupo})" só ao sair para fora do
--    churn (churn->churn não gera linha de reversão: a nova linha já descreve).
-- ---------------------------------------------------------------------
create or replace function companies_churn_capture_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_churn   text;
  v_old_churn   text;
  v_reasons     jsonb;
  v_reason      churn_reason;
  v_today       date := (timezone('America/Sao_Paulo', now()))::date;
  v_seller      text;
  v_consultants jsonb;
  v_mrr         numeric(14,2);
  v_dest_name   text;
  v_reverted    boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.group_id is not distinct from old.group_id then
      return null;
    end if;
    select churn_type into v_old_churn from company_groups where id = old.group_id;
  end if;
  select churn_type into v_new_churn from company_groups where id = new.group_id;

  -- Nem origem nem destino são churn: nada a fazer.
  if v_new_churn is null and v_old_churn is null then
    return null;
  end if;

  -- 1) SAIU de um grupo de churn: reverte o registro ativo (se houver).
  if v_old_churn is not null then
    update company_churns
       set reverted_at = now(), reverted_by = auth.uid(),
           updated_at  = now(), updated_by  = auth.uid()
     where company_id = new.id and reverted_at is null;
    v_reverted := found;

    -- Só registra "voltou para" quando saiu do churn para FORA (grupo comum / sem
    -- grupo). churn->churn não vira linha de reversão (a nova linha já descreve).
    if v_reverted and v_new_churn is null and company_exists(new.id) then
      select name into v_dest_name from company_groups where id = new.group_id;
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.id, 'churn', null,
              'Churn revertido (voltou para ' || coalesce(v_dest_name, 'Sem grupo') || ')',
              auth.uid());
    end if;
  end if;

  -- 2) ENTROU num grupo de churn: cria o registro-foto do momento.
  if v_new_churn is not null then
    if v_new_churn = 'finalizado' then
      v_reason := 'projeto_finalizado';
    else
      -- cancelado: motivo do mapa (o BEFORE já garantiu que é válido).
      v_reasons := nullif(current_setting('app.churn_reasons', true), '')::jsonb;
      v_reason  := (v_reasons ->> new.id::text)::churn_reason;
    end if;

    select closer_name into v_seller
      from company_details where company_id = new.id;

    select coalesce(
             jsonb_agg(
               jsonb_build_object('id', p.id,
                                  'name', coalesce(nullif(p.full_name, ''), p.email))
               order by coalesce(nullif(p.full_name, ''), p.email)
             ), '[]'::jsonb)
      into v_consultants
      from company_consultants cc
      join profiles p on p.id = cc.consultant_id
     where cc.company_id = new.id;

    select case
             when v.project_value is not null and v.installments is not null
                  and v.installments <> 0
             then round(v.project_value / v.installments, 2)
             else null
           end
      into v_mrr
      from company_contract_values v where v.company_id = new.id;

    insert into company_churns
      (company_id, churn_type, churned_on, reason, seller_name, consultants, mrr,
       created_by, updated_by)
    values
      (new.id, v_new_churn, v_today, v_reason, v_seller,
       coalesce(v_consultants, '[]'::jsonb), v_mrr, auth.uid(), auth.uid());

    if company_exists(new.id) then
      insert into cs_audit (company_id, field, old_value, new_value, changed_by)
      values (new.id, 'churn', null,
              case when v_new_churn = 'finalizado'
                   then 'Projeto finalizado'
                   else 'Cliente cancelado: ' || churn_reason_label(v_reason) end,
              auth.uid());
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_companies_churn_capture on companies;
create trigger trg_companies_churn_capture
  after insert or update of group_id on companies
  for each row execute function companies_churn_capture_trg();

-- ---------------------------------------------------------------------
-- 6. RPC set_companies_group — NOVA ASSINATURA (p_group_id, p_items). p_items =
--    [{company_id, reason?}]. Publica o mapa de motivos (GUC transação-local) e
--    faz o UPDATE em UM comando (inclusive em lote). Mantém o bloqueio de entrada
--    em ATIVO (0095). SECURITY INVOKER: a RLS admin de companies é a fronteira.
-- ---------------------------------------------------------------------
drop function if exists public.set_companies_group(uuid[], uuid);

create function public.set_companies_group(
  p_group_id uuid,
  p_items    jsonb
)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_ids     uuid[];
  v_reasons jsonb := '{}'::jsonb;
  v_count   integer;
  v_kind    text;
  v_gname   text;
  v_missing text;
  v_msgs    text[] := '{}';
  it        jsonb;
  r         record;
begin
  -- ids + mapa de motivos a partir do payload.
  select array_agg((x->>'company_id')::uuid)
    into v_ids
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x;

  if v_ids is null then
    return 0;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(btrim(coalesce(it->>'reason', '')), '') is not null then
      v_reasons := v_reasons || jsonb_build_object(it->>'company_id', it->>'reason');
    end if;
  end loop;

  -- Publica o mapa para os gatilhos (BEFORE valida, AFTER consome) na transação.
  perform set_config('app.churn_reasons', v_reasons::text, true);

  if p_group_id is not null then
    select kind, name into v_kind, v_gname from company_groups where id = p_group_id;
  end if;

  -- Bloqueio de entrada em ATIVO (idêntico à 0095): consultor + colaborador +
  -- tarefa ativa em CADA empresa, senão nada é movido.
  if v_kind = 'active' then
    for r in select id, name from companies where id = any (v_ids) order by name loop
      v_missing := active_group_requirements_missing(r.id);
      if v_missing is not null then
        v_msgs := array_append(v_msgs, r.name || ': ' || v_missing);
      end if;
    end loop;
    if array_length(v_msgs, 1) is not null then
      raise exception 'Para entrar em "%": %', v_gname, array_to_string(v_msgs, '; ')
        using errcode = 'P0001';
    end if;
  end if;

  update companies
     set group_id   = p_group_id,
         updated_at = now()
   where id = any (v_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.set_companies_group(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. PREENCHIMENTO das empresas HOJE em grupo de churn (comando único). Um
--    registro ATIVO por empresa: churn_type pelo grupo; reason automático
--    (projeto_finalizado | nao_informado); churned_on = data BRT do ÚLTIMO
--    'grupo_alterado' cujo toId é o grupo atual (null = "sem data"); consultores
--    atuais; closer; mrr dos valores de contrato. created_by/updated_by null
--    (Sistema). Sem cs_audit (seed one-shot; a data real já vai em churned_on).
--    on conflict: idempotente se re-rodar.
-- ---------------------------------------------------------------------
insert into company_churns
  (company_id, churn_type, churned_on, reason, seller_name, consultants, mrr,
   created_by, updated_by)
select
  c.id,
  g.churn_type,
  (
    select (ev.created_at at time zone 'America/Sao_Paulo')::date
    from company_events ev
    where ev.company_id = c.id
      and ev.event_type = 'grupo_alterado'
      and ev.details->>'toId' = g.id::text
    order by ev.created_at desc
    limit 1
  ),
  case when g.churn_type = 'finalizado'
       then 'projeto_finalizado'::churn_reason
       else 'nao_informado'::churn_reason end,
  d.closer_name,
  coalesce((
    select jsonb_agg(
             jsonb_build_object('id', p.id,
                                'name', coalesce(nullif(p.full_name, ''), p.email))
             order by coalesce(nullif(p.full_name, ''), p.email))
    from company_consultants cc
    join profiles p on p.id = cc.consultant_id
    where cc.company_id = c.id
  ), '[]'::jsonb),
  case when v.project_value is not null and v.installments is not null
            and v.installments <> 0
       then round(v.project_value / v.installments, 2)
       else null end,
  null, null
from companies c
join company_groups g on g.id = c.group_id and g.churn_type is not null
left join company_details d on d.company_id = c.id
left join company_contract_values v on v.company_id = c.id
on conflict (company_id) where reverted_at is null do nothing;
