-- =====================================================================
-- 0107 — Etiquetas de TIPO passam a ser CALCULADAS (nunca guardadas)
-- =====================================================================
-- CONSULTORIA, BPO e EMA deixam de ser vínculos manuais em company_labels e
-- passam a ser DERIVADAS de company_details.project_model. Nasce também a
-- etiqueta TRÁFEGO, derivada de company_contracted_channels contendo 'trafego'.
-- ALERTA, POTENCIALIZA AMAZON e qualquer etiqueta futura do admin seguem MANUAIS.
--
-- Fonte única das etiquetas efetivas: a view company_effective_labels
-- (security_invoker = true → respeita a RLS de quem lê), que UNE os vínculos
-- manuais de company_labels com as calculadas. Toda leitura de etiqueta no
-- sistema passa a usar essa view (app + RPCs de capacidade).
--
-- Antes de calcular, PREENCHEMOS o Modelo do Projeto a partir das etiquetas
-- atuais (com cópias de segurança), para que ninguém perca a etiqueta de tipo.
--
-- Gatilhos: company_labels recusa INSERT de etiqueta calculada; labels protege
-- as calculadas contra exclusão/renome/alteração de origem (só a cor muda).
--
-- A atribuição automática da etiqueta a partir do modelo SAI de
-- company_details_save e crm_intake_create (as etiquetas passam a sair da view).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas que marcam a etiqueta como CALCULADA.
--    derived_kind: 'project_model' | 'contracted_service'
--    derived_value: ex. 'consultoria', 'bpo', 'ema', 'trafego'
--    Ambos nulos = etiqueta manual. CHECK garante os dois juntos.
-- ---------------------------------------------------------------------
alter table labels
  add column derived_kind  text,
  add column derived_value text;

alter table labels
  add constraint labels_derived_pair_ck
    check ((derived_kind is null) = (derived_value is null));

alter table labels
  add constraint labels_derived_kind_ck
    check (derived_kind is null or derived_kind in ('project_model', 'contracted_service'));

-- ---------------------------------------------------------------------
-- 2) View única de etiquetas EFETIVAS por empresa (company_id, label_id).
--    security_invoker: a RLS das tabelas de base (company_labels / company_details
--    / company_contracted_channels) recorta quem lê. Admin vê tudo; consultor e
--    colaborador só as empresas que alcançam — exatamente como hoje.
-- ---------------------------------------------------------------------
create or replace view company_effective_labels
  with (security_invoker = true)
as
  -- Manuais (ALERTA, POTENCIALIZA AMAZON, futuras do admin).
  select cl.company_id, cl.label_id
    from company_labels cl
  union
  -- Calculadas pelo Modelo do Projeto.
  select cd.company_id, l.id as label_id
    from company_details cd
    join labels l
      on l.derived_kind  = 'project_model'
     and l.derived_value = cd.project_model::text
   where cd.project_model is not null
  union
  -- Calculadas pelos Serviços contratados (TRÁFEGO a partir de 'trafego').
  select cc.company_id, l.id as label_id
    from company_contracted_channels cc
    join labels l
      on l.derived_kind  = 'contracted_service'
     and l.derived_value = cc.channel::text;

grant select on company_effective_labels to authenticated;

-- ---------------------------------------------------------------------
-- 3) Gatilho: company_labels RECUSA INSERT de etiqueta calculada.
--    Etiqueta calculada NUNCA tem linha em company_labels.
-- ---------------------------------------------------------------------
create or replace function company_labels_reject_derived()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from labels l
     where l.id = new.label_id and l.derived_kind is not null
  ) then
    raise exception
      'Etiqueta calculada não pode ser atribuída manualmente (vem do Modelo do Projeto ou dos Serviços contratados).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_company_labels_reject_derived on company_labels;
create trigger trg_company_labels_reject_derived
  before insert on company_labels
  for each row execute function company_labels_reject_derived();

-- =====================================================================
-- PREENCHIMENTO (na mesma migration, nesta ordem)
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) Cópias de segurança — NÃO são apagadas depois. RLS ativa e sem policy
--     (ninguém lê pela API).
-- ---------------------------------------------------------------------
create table backup_company_labels_20261008 as
  select * from company_labels;
alter table backup_company_labels_20261008 enable row level security;

create table backup_company_details_model_20261008 as
  select company_id, project_model from company_details;
alter table backup_company_details_model_20261008 enable row level security;

-- ---------------------------------------------------------------------
-- (2) Conflitos por ID → modelo 'bpo' (upsert em company_details).
-- (3) project_model NULO + exatamente UMA etiqueta de tipo → preencher o
--     modelo correspondente (upsert). Esperado: 93. Outro número ABORTA.
--     Comandos únicos, sem laço.
-- ---------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  -- (2) Conflitos.
  insert into company_details (company_id, project_model)
  values
    ('f936b73e-1412-4e18-ba84-b10ba726c912', 'bpo'),  -- 283. INNO INFORMATICA
    ('f2589d8c-417c-443e-8cfd-dbb6ba6db9af', 'bpo'),  -- 339. FILLOMIO
    ('3fbd011d-53ad-41d0-95d2-ae17db3dbfa8', 'bpo')   -- 311. MADRI MOBÍLIA
  on conflict (company_id) do update set project_model = excluded.project_model;

  -- (3) Modelo nulo + exatamente uma etiqueta de tipo.
  with type_counts as (
    select cl.company_id,
           count(*)      as n,
           max(l.name)   as single_name
      from company_labels cl
      join labels l on l.id = cl.label_id
     where l.name in ('CONSULTORIA', 'BPO', 'EMA')
     group by cl.company_id
  ),
  targets as (
    select tc.company_id,
           (case tc.single_name
              when 'CONSULTORIA' then 'consultoria'
              when 'BPO'         then 'bpo'
              when 'EMA'         then 'ema'
            end)::project_model as model
      from type_counts tc
      left join company_details d on d.company_id = tc.company_id
     where tc.n = 1
       and d.project_model is null
  ),
  upsert as (
    insert into company_details (company_id, project_model)
    select company_id, model from targets
    on conflict (company_id) do update set project_model = excluded.project_model
    returning 1
  )
  select count(*) into v_n from upsert;

  if v_n <> 93 then
    raise exception 'Preenchimento do modelo afetou % empresas (esperado 93) — ABORTADO.', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- (4) Apagar de company_labels os vínculos de CONSULTORIA, BPO e EMA.
--     (Dispara o gatilho de histórico — eventos registrados como Sistema;
--     por decisão, NÃO suprimimos gatilhos.)
-- ---------------------------------------------------------------------
delete from company_labels cl
  using labels l
 where cl.label_id = l.id
   and l.name in ('CONSULTORIA', 'BPO', 'EMA');

-- ---------------------------------------------------------------------
-- (5) Marcar os labels como calculados + criar TRÁFEGO.
--     (Feito ANTES de criar o gatilho de proteção, logo abaixo.)
-- ---------------------------------------------------------------------
update labels set derived_kind = 'project_model', derived_value = 'consultoria' where name = 'CONSULTORIA';
update labels set derived_kind = 'project_model', derived_value = 'bpo'         where name = 'BPO';
update labels set derived_kind = 'project_model', derived_value = 'ema'         where name = 'EMA';

insert into labels (name, bg_color, text_color, highlight, derived_kind, derived_value)
values ('TRÁFEGO', '#EA580C', '#FFFFFF', false, 'contracted_service', 'trafego');

-- ---------------------------------------------------------------------
-- 7) Gatilho: protege etiquetas calculadas.
--    Não podem ser excluídas, renomeadas, nem ter a origem alterada. Só a cor
--    (e demais campos cosméticos) muda. Também impede transformar uma etiqueta
--    manual existente em calculada por UPDATE direto.
--    Criado DEPOIS do passo (5) para não bloquear a própria marcação acima.
-- ---------------------------------------------------------------------
create or replace function labels_protect_derived()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.derived_kind is not null then
      raise exception 'Etiqueta calculada não pode ser excluída.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.derived_kind is not null then
    if new.name          is distinct from old.name
       or new.derived_kind  is distinct from old.derived_kind
       or new.derived_value is distinct from old.derived_value then
      raise exception
        'Etiqueta calculada não pode ser renomeada nem ter sua origem alterada (apenas a cor).'
        using errcode = 'check_violation';
    end if;
  elsif new.derived_kind is not null then
    raise exception 'Não é possível transformar uma etiqueta existente em calculada.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_labels_protect_derived on labels;
create trigger trg_labels_protect_derived
  before update or delete on labels
  for each row execute function labels_protect_derived();

-- =====================================================================
-- Remover a ATRIBUIÇÃO AUTOMÁTICA de etiqueta a partir do modelo.
-- As etiquetas agora saem da view; o intake segue gravando project_model e
-- serviços normalmente.
-- =====================================================================

-- company_details_save — sem o bloco de etiqueta automática (resto idêntico).
create or replace function company_details_save(
  p_company       uuid,
  p_project_model text,
  p_started_on    date,
  p_ends_on       date,
  p_cadence       text,
  p_system_used   text,
  p_main_pain     text,
  p_about         text,
  p_channels      text[]
)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_model   project_model    := nullif(btrim(coalesce(p_project_model, '')), '')::project_model;
  v_cadence contract_cadence := nullif(btrim(coalesce(p_cadence, '')), '')::contract_cadence;
  v_system  text := nullif(btrim(coalesce(p_system_used, '')), '');
  v_pain    text := nullif(btrim(coalesce(p_main_pain, '')), '');
  v_about   text := nullif(btrim(coalesce(p_about, '')), '');
begin
  insert into company_details
    (company_id, project_model, started_on, ends_on, cadence,
     system_used, main_pain, about)
  values
    (p_company, v_model, p_started_on, p_ends_on, v_cadence,
     v_system, v_pain, v_about)
  on conflict (company_id) do update set
    project_model = excluded.project_model,
    started_on    = excluded.started_on,
    ends_on       = excluded.ends_on,
    cadence       = excluded.cadence,
    system_used   = excluded.system_used,
    main_pain     = excluded.main_pain,
    about         = excluded.about;  -- trigger carimba updated_*

  -- Sincroniza os serviços contratados: remove os que saíram, insere os novos.
  delete from company_contracted_channels
   where company_id = p_company
     and channel <> all (
       select c::contracted_service
         from unnest(coalesce(p_channels, '{}')) as c
     );

  insert into company_contracted_channels (company_id, channel)
  select p_company, c::contracted_service
    from unnest(coalesce(p_channels, '{}')) as c
  on conflict (company_id, channel) do nothing;
end;
$$;

grant execute on function company_details_save(
  uuid, text, date, date, text, text, text, text, text[]
) to authenticated;

-- crm_intake_create — sem o bloco de etiqueta automática (resto idêntico ao
-- vivo da 0097: contrato/closer/serviços intactos).
create or replace function crm_intake_create(
  p_payload jsonb,
  p_source  text default null,
  p_ip      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip_hash   text := case when p_ip is null then null
                           else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_recent    integer;
  v_num_txt   text := btrim(coalesce(p_payload->>'number', ''));
  v_log_num   integer := case when btrim(coalesce(p_payload->>'number','')) ~ '^\d{1,9}$'
                              then btrim(p_payload->>'number')::int else null end;
  v_number    integer;
  v_razao     text := btrim(coalesce(p_payload->>'razao_social', ''));
  v_contato   text := nullif(btrim(coalesce(p_payload->>'contato', '')), '');
  v_cnpj      text := nullif(regexp_replace(coalesce(p_payload->>'cnpj', ''), '\D', '', 'g'), '');
  v_model     text := nullif(btrim(coalesce(p_payload->>'project_model', '')), '');
  v_cadence   text := nullif(btrim(coalesce(p_payload->>'cadence', '')), '');
  v_started   text := nullif(btrim(coalesce(p_payload->>'started_on', '')), '');
  v_ends      text := nullif(btrim(coalesce(p_payload->>'ends_on', '')), '');
  v_system    text := nullif(btrim(coalesce(p_payload->>'system_used', '')), '');
  v_pain      text := nullif(btrim(coalesce(p_payload->>'main_pain', '')), '');
  v_about     text := nullif(btrim(coalesce(p_payload->>'about', '')), '');
  v_closer    text := nullif(btrim(coalesce(p_payload->>'closer_name', '')), '');
  v_pv_raw    text := nullif(btrim(coalesce(p_payload->>'project_value', '')), '');
  v_inst_raw  text := nullif(btrim(coalesce(p_payload->>'installments', '')), '');
  v_pv        numeric(14,2);
  v_inst      integer;
  v_services  text[];
  v_svc       text;
  v_started_d date;
  v_ends_d    date;
  v_name      text;
  v_group     uuid;
  v_company   uuid;
  v_hit       record;
  v_date_re   text := '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$';
  v_text_cap  int := 5000;
begin
  select count(*) into v_recent
    from crm_intake_log
   where action = 'create'
     and received_at > now() - interval '1 minute';
  if v_recent >= 60 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;

  if v_num_txt = '' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Número da empresa é obrigatório.', 'refused_validation');
  end if;
  if v_num_txt !~ '^\d{1,9}$' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Número deve ser um inteiro positivo (até 9 dígitos).', 'refused_validation');
  end if;
  v_number := v_num_txt::int;
  if v_number < 1 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Número deve ser maior que zero.', 'refused_validation');
  end if;

  if v_razao = '' then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Razão social é obrigatória.', 'refused_validation');
  end if;
  if char_length(v_razao) > 200 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Razão social muito longa (máx. 200).', 'refused_validation');
  end if;
  if v_contato is not null and char_length(v_contato) > 120 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Contato muito longo (máx. 120).', 'refused_validation');
  end if;

  if v_cnpj is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'CNPJ é obrigatório.', 'refused_validation');
  end if;
  if length(v_cnpj) <> 14 or not is_valid_cnpj(v_cnpj) then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'CNPJ inválido.', 'refused_validation');
  end if;

  if v_model is not null and v_model not in ('bpo', 'consultoria', 'ema') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Modelo de projeto inválido (bpo|consultoria|ema).', 'refused_validation');
  end if;
  if v_cadence is not null and v_cadence not in
       ('semanal', 'quinzenal', 'semanal_quinzenal', 'quinzenal_semanal') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Cadência inválida.', 'refused_validation');
  end if;

  if v_started is not null then
    if v_started !~ v_date_re then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'started_on inválida (AAAA-MM-DD).', 'refused_validation');
    end if;
    begin v_started_d := v_started::date;
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'started_on não é uma data válida.', 'refused_validation');
    end;
  end if;
  if v_ends is not null then
    if v_ends !~ v_date_re then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'ends_on inválida (AAAA-MM-DD).', 'refused_validation');
    end if;
    begin v_ends_d := v_ends::date;
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'ends_on não é uma data válida.', 'refused_validation');
    end;
  end if;
  if v_started_d is not null and v_ends_d is not null and v_ends_d < v_started_d then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'ends_on não pode ser antes de started_on.', 'refused_validation');
  end if;

  if coalesce(char_length(v_system), 0) > v_text_cap
     or coalesce(char_length(v_pain), 0) > v_text_cap
     or coalesce(char_length(v_about), 0) > v_text_cap then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Um dos textos excede 5000 caracteres.', 'refused_validation');
  end if;

  if v_closer is not null and char_length(v_closer) > 200 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'closer_name muito longo (máx. 200).', 'refused_validation');
  end if;

  if p_payload ? 'monthly_value' or p_payload ? 'valor_mensal'
     or p_payload ? 'monthly_amount' then
    raise notice 'crm_intake: valor mensal recebido e IGNORADO (é derivado de project_value/installments). numero=%', v_number;
  end if;

  if v_pv_raw is not null then
    if v_pv_raw !~ '^\d+(\.\d+)?$' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'project_value inválido (número decimal não negativo).', 'refused_validation');
    end if;
    begin
      v_pv := v_pv_raw::numeric(14,2);
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'project_value fora da faixa suportada.', 'refused_validation');
    end;
    if v_pv < 0 then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'project_value não pode ser negativo.', 'refused_validation');
    end if;
  end if;

  if v_inst_raw is not null then
    if v_inst_raw !~ '^\d+$' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'installments inválido (inteiro positivo).', 'refused_validation');
    end if;
    begin
      v_inst := v_inst_raw::integer;
    exception when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'installments fora da faixa suportada.', 'refused_validation');
    end;
    if v_inst < 1 then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'installments deve ser maior que zero.', 'refused_validation');
    end if;
  end if;

  if p_payload ? 'contracted_services'
     and jsonb_typeof(p_payload->'contracted_services') is distinct from 'null' then
    if jsonb_typeof(p_payload->'contracted_services') <> 'array' then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'validation', 'contracted_services deve ser uma lista.', 'refused_validation');
    end if;
    select array_agg(distinct btrim(x)) into v_services
      from jsonb_array_elements_text(p_payload->'contracted_services') as t(x)
     where btrim(x) <> '';
    if v_services is not null then
      foreach v_svc in array v_services loop
        if v_svc not in ('mercado_livre','shopee','amazon','trafego','gestao_site','desenvolvimento_site') then
          return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
                   'validation', 'Serviço contratado inválido: ' || v_svc, 'refused_validation');
        end if;
      end loop;
    end if;
  end if;

  select c.id, c.name into v_hit
    from companies c
   where c.cnpj = v_cnpj
   limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'cnpj_in_use',
             'O CNPJ informado já está cadastrado na empresa "' || v_hit.name || '".',
             'refused_cnpj',
             jsonb_build_object('id', v_hit.id, 'name', v_hit.name));
  end if;

  select c.id, c.name into v_hit
    from companies c
   where crm_name_number(c.name) = v_number
   limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'number_in_use',
             'O número ' || v_number || ' já está em uso pela empresa "' || v_hit.name || '".',
             'refused_number',
             jsonb_build_object('id', v_hit.id, 'name', v_hit.name));
  end if;

  select id into v_group from company_groups where lower(name) = 'on boarding' limit 1;
  if v_group is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'internal', 'Grupo "On Boarding" não encontrado.', 'error');
  end if;

  v_name := v_number || '. ' || v_razao
            || case when v_contato is not null then ' (' || v_contato || ')' else '' end;

  begin
    insert into companies (name, group_id, created_by, cnpj)
    values (v_name, v_group, null, v_cnpj)
    returning id into v_company;

    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (v_company, 'empresa_criada_crm',
            'Empresa criada a partir do CRM comercial',
            jsonb_build_object('number', v_number, 'source', p_source),
            null);

    insert into company_details
      (company_id, project_model, started_on, ends_on, cadence,
       system_used, main_pain, about, closer_name)
    values
      (v_company,
       v_model::project_model,
       v_started_d, v_ends_d,
       v_cadence::contract_cadence,
       v_system, v_pain, v_about, v_closer);

    if v_pv is not null or v_inst is not null then
      insert into company_contract_values (company_id, project_value, installments)
      values (v_company, v_pv, v_inst);
    end if;

    -- (Etiqueta automática do modelo REMOVIDA: a etiqueta de tipo agora é
    --  calculada na view company_effective_labels.)

    if v_services is not null and array_length(v_services, 1) > 0 then
      insert into company_contracted_channels (company_id, channel)
      select v_company, x::contracted_service
        from unnest(v_services) as x
      on conflict (company_id, channel) do nothing;
    end if;

  exception
    when unique_violation then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'duplicate',
               'Já existe empresa com este nome ou CNPJ (' || v_name || ').',
               'refused_duplicate');
    when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'internal', 'Falha ao criar: ' || sqlerrm, 'error');
  end;

  insert into crm_intake_log
    (action, source, ip_hash, number, razao_social, result, reason, company_id, payload)
  values ('create', p_source, v_ip_hash, v_number, left(v_razao, 200),
          'created', 'Empresa criada em On Boarding', v_company, p_payload);

  return jsonb_build_object('ok', true, 'id', v_company, 'name', v_name);
end;
$$;

-- =====================================================================
-- Trocar as leituras de etiqueta das RPCs de capacidade para a view.
-- (SECURITY DEFINER: a view, lida de dentro, roda no papel do dono → traz todas
--  as empresas, como já ocorria lendo company_labels diretamente. Guard is_admin
--  intacto.) Único ponto alterado: company_labels → company_effective_labels.
-- =====================================================================

create or replace function team_capacity(p_start date default null, p_end date default null)
returns table(
  person_id uuid, person_name text, avatar_path text,
  carteira_active integer, carteira_by_group jsonb, carteira_exclusive integer,
  carteira_shared integer, carteira_alerta integer, carteira_stalled integer,
  carteira_no_record integer, is_executor boolean, act_seconds bigint,
  act_seconds_pontual bigint, act_seconds_diaria bigint, act_pontual_done integer,
  act_overdue integer, act_companies integer, act_has_activity boolean,
  colab_active integer, colab_by_group jsonb, has_colab_carteira boolean,
  colab_out_of_portfolio integer
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  with
  people as (
    select consultant_id as id from company_consultants
    union
    select collaborator_id from task_instances where collaborator_id is not null
    union
    select collaborator_id from company_collaborators
  ),
  executors as (
    select distinct collaborator_id as id
      from task_instances
     where collaborator_id is not null
  ),
  carteira as (
    select cc.consultant_id as person,
           cc.company_id,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  active_carteira as (
    select person, company_id from carteira where is_active
  ),
  company_consultant_count as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  followup as (
    select company_id, days_since from client_followup(30, true)
  ),
  by_group as (
    select person,
           jsonb_agg(
             jsonb_build_object('name', gname, 'count', n)
             order by gpos, gname
           ) as list
      from (
        select person, gname, gpos, count(*) as n
          from carteira
         group by person, gname, gpos
      ) q
     group by person
  ),
  cart as (
    select ac.person,
           count(*) as active,
           count(*) filter (where ccc.n = 1) as exclusive,
           count(*) filter (where ccc.n > 1) as shared,
           count(*) filter (where al.company_id is not null) as alerta,
           count(*) filter (where fu.days_since > 15)      as stalled,
           count(*) filter (where fu.days_since is null)   as no_record
      from active_carteira ac
      join company_consultant_count ccc on ccc.company_id = ac.company_id
      left join followup fu on fu.company_id = ac.company_id
      left join lateral (
        select 1 as company_id
          from company_effective_labels cl
          join labels l on l.id = cl.label_id
         where cl.company_id = ac.company_id
           and lower(l.name) = 'alerta'
         limit 1
      ) al on true
     group by ac.person
  ),
  colab_carteira as (
    select cc.collaborator_id as person,
           coalesce(g.name, 'Sem grupo') as gname,
           coalesce(g.position, 2147483647) as gpos,
           (c.group_id is null or g.name is null or not (g.name = any(v_excluded))) as is_active
      from company_collaborators cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
  ),
  colab_by_group as (
    select person,
           jsonb_agg(
             jsonb_build_object('name', gname, 'count', n)
             order by gpos, gname
           ) as list
      from (
        select person, gname, gpos, count(*) as n
          from colab_carteira
         group by person, gname, gpos
      ) q
     group by person
  ),
  colab_active as (
    select person, count(*) filter (where is_active) as active
      from colab_carteira
     group by person
  ),
  colab_outside as (
    select ti.collaborator_id as person, count(distinct ti.company_id) as n
      from task_instances ti
     where ti.collaborator_id is not null
       and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id
            and cc.collaborator_id = ti.collaborator_id
       )
     group by ti.collaborator_id
  ),
  act_time as (
    select te.collaborator_id as person,
           sum(entry_seconds(te.seconds, te.started_at, te.ended_at))::bigint as secs,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind = 'diaria'))::bigint as secs_diaria,
           (sum(entry_seconds(te.seconds, te.started_at, te.ended_at))
             filter (where tt.kind is distinct from 'diaria'))::bigint as secs_pontual
      from time_entries te
      join task_instances t on t.id = te.task_id
      left join task_templates tt on tt.id = t.template_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
     group by te.collaborator_id
  ),
  act_done as (
    select ti.collaborator_id as person, count(*) as done
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada'
       and tt.kind = 'unica'
       and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
     group by ti.collaborator_id
  ),
  act_company_pairs as (
    select te.collaborator_id as person, t.company_id
      from time_entries te
      join task_instances t on t.id = te.task_id
     where (v_start_ts is null or te.started_at >= v_start_ts)
       and (v_end_ts   is null or te.started_at <  v_end_ts)
    union
    select ti.collaborator_id, ti.company_id
      from task_instances ti
      join task_templates tt on tt.id = ti.template_id
     where ti.status = 'finalizada'
       and tt.kind = 'unica'
       and ti.finished_at is not null
       and (v_start_ts is null or ti.finished_at >= v_start_ts)
       and (v_end_ts   is null or ti.finished_at <  v_end_ts)
  ),
  act_companies as (
    select person, count(distinct company_id) as companies
      from act_company_pairs
     where company_id is not null
     group by person
  ),
  act_overdue as (
    select ti.collaborator_id as person, count(*) as n
      from task_instances ti
     where ti.status in ('a_fazer', 'iniciada')
       and ti.due_at < now()
       and (p_start is null or ti.task_date >= p_start)
       and (p_end   is null or ti.task_date <  p_end)
     group by ti.collaborator_id
  )
  select
    pe.id,
    dp.name,
    dp.avatar_path,
    coalesce(cart.active, 0)::integer,
    coalesce(bg.list, '[]'::jsonb),
    coalesce(cart.exclusive, 0)::integer,
    coalesce(cart.shared, 0)::integer,
    coalesce(cart.alerta, 0)::integer,
    coalesce(cart.stalled, 0)::integer,
    coalesce(cart.no_record, 0)::integer,
    (ex.id is not null) as is_executor,
    coalesce(at.secs, 0)::bigint,
    coalesce(at.secs_pontual, 0)::bigint,
    coalesce(at.secs_diaria, 0)::bigint,
    coalesce(ad.done, 0)::integer,
    coalesce(ao.n, 0)::integer,
    coalesce(acp.companies, 0)::integer,
    (at.person is not null or ad.person is not null or ao.person is not null) as act_has_activity,
    coalesce(ca.active, 0)::integer,
    coalesce(cbg.list, '[]'::jsonb),
    (cbg.person is not null) as has_colab_carteira,
    coalesce(oop.n, 0)::integer
  from people pe
  left join lateral (
    select d.name, d.avatar_path from display_profiles(array[pe.id]::uuid[]) d
  ) dp on true
  left join executors ex on ex.id = pe.id
  left join cart      on cart.person = pe.id
  left join by_group  bg on bg.person = pe.id
  left join colab_active ca on ca.person = pe.id
  left join colab_by_group cbg on cbg.person = pe.id
  left join colab_outside oop on oop.person = pe.id
  left join act_time  at on at.person = pe.id
  left join act_done  ad on ad.person = pe.id
  left join act_companies acp on acp.person = pe.id
  left join act_overdue ao on ao.person = pe.id;
end;
$$;

create or replace function team_capacity_drilldown(
  p_person uuid, p_scope text, p_start date default null, p_end date default null
)
returns table(
  company_id uuid, company_name text, group_name text,
  labels jsonb, shared_with jsonb, days_since integer
)
language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_excluded text[] := capacity_excluded_groups();
  v_start_ts timestamptz := case when p_start is null then null
                                 else p_start::timestamp at time zone 'America/Sao_Paulo' end;
  v_end_ts   timestamptz := case when p_end is null then null
                                 else p_end::timestamp at time zone 'America/Sao_Paulo' end;
begin
  if not is_admin() then
    raise exception 'team_capacity_drilldown: acesso restrito a administradores'
      using errcode = '42501';
  end if;

  return query
  with
  active_carteira as (
    select cc.company_id
      from company_consultants cc
      join companies c on c.id = cc.company_id
      left join company_groups g on g.id = c.group_id
     where cc.consultant_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  ),
  cnt as (
    select company_id, count(*) as n from company_consultants group by company_id
  ),
  fu as (
    select company_id, days_since from client_followup(30, true)
  ),
  carteira_scoped as (
    select ac.company_id,
           coalesce(cnt.n, 1) as ncons,
           fu.days_since as dsince
      from active_carteira ac
      left join cnt on cnt.company_id = ac.company_id
      left join fu on fu.company_id = ac.company_id
  ),
  scoped as (
    select cs.company_id, cs.dsince
      from carteira_scoped cs
     where p_scope in ('ativos','exclusivos','compartilhados','alerta','parados','sem_registro')
       and case p_scope
             when 'exclusivos'     then cs.ncons = 1
             when 'compartilhados' then cs.ncons > 1
             when 'alerta'         then exists (
               select 1 from company_effective_labels cl
                 join labels l on l.id = cl.label_id
                where cl.company_id = cs.company_id
                  and lower(l.name) = 'alerta')
             when 'parados'        then (cs.dsince is not null and cs.dsince > 15)
             when 'sem_registro'   then cs.dsince is null
             else true
           end
    union all
    select e.company_id, null::integer
      from (
        select distinct t.company_id
          from time_entries te
          join task_instances t on t.id = te.task_id
         where p_scope = 'empresas'
           and te.collaborator_id = p_person
           and (v_start_ts is null or te.started_at >= v_start_ts)
           and (v_end_ts   is null or te.started_at <  v_end_ts)
        union
        select distinct ti.company_id
          from task_instances ti
          join task_templates tt on tt.id = ti.template_id
         where p_scope = 'empresas'
           and ti.collaborator_id = p_person
           and ti.status = 'finalizada'
           and tt.kind = 'unica'
           and ti.finished_at is not null
           and (v_start_ts is null or ti.finished_at >= v_start_ts)
           and (v_end_ts   is null or ti.finished_at <  v_end_ts)
      ) e
     where e.company_id is not null
    union all
    select distinct ti.company_id, null::integer
      from task_instances ti
     where p_scope = 'fora_da_carteira'
       and ti.collaborator_id = p_person
       and ti.company_id is not null
       and ti.status in ('a_fazer', 'iniciada')
       and not exists (
         select 1 from company_collaborators cc
          where cc.company_id = ti.company_id
            and cc.collaborator_id = p_person
       )
    union all
    select ccx.company_id, null::integer
      from company_collaborators ccx
      join companies c on c.id = ccx.company_id
      left join company_groups g on g.id = c.group_id
     where p_scope = 'colab_ativos'
       and ccx.collaborator_id = p_person
       and (c.group_id is null or g.name is null or not (g.name = any(v_excluded)))
  )
  select
    s.company_id,
    c.name,
    coalesce(g.name, 'Sem grupo'),
    coalesce(lab.list, '[]'::jsonb),
    coalesce(sh.list, '[]'::jsonb),
    s.dsince
  from scoped s
  join companies c on c.id = s.company_id
  left join company_groups g on g.id = c.group_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('name', l.name, 'bg_color', l.bg_color,
                                'text_color', l.text_color, 'highlight', l.highlight)
             order by l.highlight desc, l.name
           ) as list
      from company_effective_labels cl
      join labels l on l.id = cl.label_id
     where cl.company_id = s.company_id
  ) lab on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('id', d.id, 'name', d.name, 'avatar_path', d.avatar_path)
             order by d.name
           ) as list
      from company_consultants cc2
      cross join lateral display_profiles(array[cc2.consultant_id]::uuid[]) d
     where p_scope = 'compartilhados'
       and cc2.company_id = s.company_id
       and cc2.consultant_id <> p_person
  ) sh on true
  order by c.name;
end;
$$;
