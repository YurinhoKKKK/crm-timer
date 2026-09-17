-- =====================================================================
-- INTEGRAÇÃO com o CRM comercial — ponta que RECEBE clientes fechados
-- =====================================================================
-- O CRM comercial (outro projeto Supabase) envia clientes fechados para cá.
-- Este é o lado que RECEBE e cria a empresa em "On Boarding". Toda a lógica mora
-- em DUAS RPCs SECURITY DEFINER, chamadas pelas rotas Next.js autenticadas por
-- SEGREDO COMPARTILHADO (cabeçalho). As RPCs são concedidas SÓ ao service_role —
-- anon/authenticated NÃO podem chamá-las via PostgREST (a chave anon é pública),
-- então a única porta é a rota do servidor, atrás do segredo.
--
-- DECISÕES (não reabrir):
--  · SEM coluna de número. O número faz parte do TEXTO do nome, como hoje
--    ("376. RAZAO SOCIAL LTDA (Contato)"). Este sistema NÃO gera número — ele
--    chega pronto do CRM. Empresa sem número não é criada por aqui.
--  · Nasce no grupo "On Boarding", SEM consultor e SEM colaborador. Distribuição
--    é decidida depois por um admin.
--  · Porta ESTREITA: só cria (empresa + company_details + canais + evento),
--    atômico. Não atualiza, não apaga, não toca em tarefa/faturamento/usuário.
--  · Sem CNPJ nesta base: a conferência de duplicado é por NOME e APROXIMADA
--    (ignora maiúsculas, acentos, pontuação e o número do início).
-- =====================================================================

-- Ferramentas de texto para a comparação tolerante. unaccent tira acentos;
-- pg_trgm dá similarity() para o "parecido". Instaladas no schema extensions
-- (padrão do Supabase) — as funções abaixo usam search_path = public, extensions.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Garante o grupo "On Boarding" (já existe hoje; idempotente). NUNCA hardcodar o
-- id: as RPCs resolvem por nome em tempo de execução.
insert into company_groups (name, color, position)
select 'On Boarding', '#3145FF',
       coalesce((select max(position) from company_groups), 0) + 1
where not exists (
  select 1 from company_groups where lower(name) = 'on boarding'
);

-- ---------------------------------------------------------------------
-- Auditoria: uma linha por CHAMADA recebida (quem, quando, resultado). Também é
-- a base do rate limit (conta chamadas do último minuto). Append-only; escrita
-- só pelas RPCs SECURITY DEFINER. Admin pode LER para conferência.
-- ---------------------------------------------------------------------
create table crm_intake_log (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  action        text not null,            -- 'create' | 'dedup'
  source        text,                     -- identificador livre do chamador (cabeçalho)
  ip_hash       text,                     -- sha256 do IP (nunca o IP cru)
  number        integer,                  -- número recebido (create)
  razao_social  text,                     -- razão social recebida (crua, limitada)
  result        text not null,            -- created | refused_* | rate_limited | error | ok
  reason        text,                     -- mensagem legível do resultado
  company_id    uuid references companies(id) on delete set null,
  payload       jsonb                     -- payload recebido, para auditoria
);

create index idx_crm_intake_log_received on crm_intake_log (received_at desc);
create index idx_crm_intake_log_action_received on crm_intake_log (action, received_at desc);

alter table crm_intake_log enable row level security;

-- Só admin lê a auditoria pela API do PostgREST. Sem insert/update/delete: quem
-- grava é a RPC SECURITY DEFINER (roda como dono, ignora RLS).
create policy cil_admin_select on crm_intake_log for select using (is_admin());

-- ---------------------------------------------------------------------
-- Helpers de normalização de nome (para a comparação tolerante).
-- STABLE (não IMMUTABLE) porque unaccent depende de dicionário.
-- ---------------------------------------------------------------------

-- Normaliza um texto qualquer: sem acento, minúsculo, só [a-z0-9] e espaço,
-- espaços colapsados. Base do "ignora maiúsculas/acentos/pontuação".
create or replace function crm_normalize_name(p text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select btrim(regexp_replace(
           lower(unaccent(coalesce(p, ''))),
           '[^a-z0-9]+', ' ', 'g'
         ));
$$;

-- "Núcleo" comparável de um nome de empresa: tira o NÚMERO do início, o
-- CONTATO entre parênteses no fim, normaliza e remove sufixos jurídicos comuns
-- (ltda/me/epp/eireli/sa) para não inflar a semelhança por causa deles.
create or replace function crm_core_name(p text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select btrim(regexp_replace(
           regexp_replace(
             crm_normalize_name(
               regexp_replace(                                   -- tira "(...)" final
                 regexp_replace(coalesce(p, ''), '^\s*\d+\s*[.\-]?\s*', ''),  -- tira número inicial
                 '\s*\([^)]*\)\s*$', ''
               )
             ),
             '\y(ltda|me|epp|eireli|sa)\y', ' ', 'g'            -- tira sufixo jurídico
           ),
           '\s+', ' ', 'g'                                       -- colapsa espaços
         ));
$$;

-- Extrai o número do início do nome ("376. ..." -> 376). null se não houver.
create or replace function crm_name_number(p text)
returns integer
language sql
immutable
set search_path = public
as $$
  select nullif(substring(coalesce(p, '') from '^\s*(\d{1,9})'), '')::integer;
$$;

-- ---------------------------------------------------------------------
-- Catálogo de rótulos do histórico: adiciona o evento de criação via CRM.
-- (create or replace preserva o resto; só acrescenta o novo case.)
-- ---------------------------------------------------------------------
create or replace function activity_type_label(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    when 'atividade'                      then 'Atividade'
    when 'tarefa_criada'                  then 'Tarefa criada'
    when 'tarefa_concluida'               then 'Tarefa concluída'
    when 'tarefa_excluida'                then 'Tarefa excluída'
    when 'tarefa_recorrente_criada'       then 'Tarefa recorrente criada'
    when 'tarefa_recorrente_editada'      then 'Tarefa recorrente editada'
    when 'tarefa_recorrente_desativada'   then 'Tarefa recorrente desativada'
    when 'consultor_adicionado'           then 'Consultor adicionado'
    when 'consultor_removido'             then 'Consultor removido'
    when 'grupo_alterado'                 then 'Grupo alterado'
    when 'etiqueta_alterada'              then 'Etiqueta alterada'
    when 'faturamento_lancado'            then 'Faturamento lançado'
    when 'faturamento_corrigido'          then 'Faturamento corrigido'
    when 'informacoes_alteradas'          then 'Informações alteradas'
    when 'empresa_criada_crm'             then 'Empresa criada (CRM comercial)'
    when 'acesso_cliente_criado'          then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_revogado'        then 'Acesso do cliente revogado'
    when 'listagem_validada'              then 'Listagem validada'
    when 'reuniao_criada'                 then 'Reunião criada'
    when 'reuniao_cancelada'              then 'Reunião cancelada'
    else p_type
  end;
$$;

-- ---------------------------------------------------------------------
-- Helper interno: empresas PARECIDAS com uma razão social.
-- p_min = limiar de similaridade. Devolve id, nome, grupo e similarity,
-- da mais parecida para a menos. Também casa por CONTINÊNCIA (uma núcleo
-- contém a outra), que o trigrama às vezes subestima em nomes curtos.
-- ---------------------------------------------------------------------
create or replace function crm_similar_companies(p_razao text, p_min real, p_limit int)
returns table (id uuid, name text, group_name text, sim real)
language sql
stable
set search_path = public, extensions
as $$
  with base as (
    select crm_core_name(p_razao) as core
  )
  select c.id,
         c.name,
         g.name as group_name,
         similarity(crm_core_name(c.name), b.core) as sim
    from companies c
    cross join base b
    left join company_groups g on g.id = c.group_id
   where b.core <> ''
     and crm_core_name(c.name) <> ''
     and (
       similarity(crm_core_name(c.name), b.core) >= p_min
       or crm_core_name(c.name) = b.core
       or crm_core_name(c.name) like '%' || b.core || '%'
       or b.core like '%' || crm_core_name(c.name) || '%'
     )
   order by sim desc, c.name
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---------------------------------------------------------------------
-- Helper de auditoria+recusa: grava a linha de log e devolve o jsonb de erro.
-- (plpgsql não tem função aninhada; este é o helper top-level compartilhado.)
-- ---------------------------------------------------------------------
create or replace function crm_intake_refuse(
  p_action    text,
  p_source    text,
  p_ip_hash   text,
  p_number    integer,
  p_razao     text,
  p_payload   jsonb,
  p_code      text,
  p_message   text,
  p_result    text,
  p_collision jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into crm_intake_log
    (action, source, ip_hash, number, razao_social, result, reason, payload)
  values
    (p_action, p_source, p_ip_hash, p_number, left(coalesce(p_razao, ''), 200),
     p_result, p_message, p_payload);
  return jsonb_build_object('ok', false, 'error', p_code, 'message', p_message)
         || case when p_collision is null then '{}'::jsonb
                 else jsonb_build_object('collision', p_collision) end;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC 1 — CONFERÊNCIA DE DUPLICADO. Recebe uma razão social e devolve as
-- empresas parecidas (id, nome, grupo). Rate-limited e auditada.
-- ---------------------------------------------------------------------
create or replace function crm_intake_check_duplicate(
  p_razao  text,
  p_source text default null,
  p_ip     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_razao   text := btrim(coalesce(p_razao, ''));
  v_ip_hash text := case when p_ip is null then null
                         else encode(digest(p_ip, 'sha256'), 'hex') end;
  v_recent  integer;
  v_matches jsonb;
begin
  -- Rate limit: 120 conferências/min (leitura, teto mais folgado que o de criar).
  select count(*) into v_recent
    from crm_intake_log
   where action = 'dedup'
     and received_at > now() - interval '1 minute';
  if v_recent >= 120 then
    return crm_intake_refuse('dedup', p_source, v_ip_hash, null, v_razao, null,
             'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;

  if v_razao = '' then
    return crm_intake_refuse('dedup', p_source, v_ip_hash, null, null, null,
             'validation', 'Informe a razão social.', 'refused_validation');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'group', s.group_name,
           'similarity', round(s.sim::numeric, 3)
         ) order by s.sim desc, s.name), '[]'::jsonb)
    into v_matches
    from crm_similar_companies(v_razao, 0.35, 20) s;

  insert into crm_intake_log (action, source, ip_hash, razao_social, result, reason)
  values ('dedup', p_source, v_ip_hash, left(v_razao, 200), 'ok',
          jsonb_array_length(v_matches) || ' parecida(s)');

  return jsonb_build_object('ok', true, 'matches', v_matches);
end;
$$;

-- ---------------------------------------------------------------------
-- RPC 2 — CRIAÇÃO. Valida tudo, recusa duplicado forte / número em uso, e cria
-- empresa + company_details + canais + evento de forma ATÔMICA. Rate-limited e
-- auditada. Retorna { ok, id, name } ou { ok:false, error, message, collision? }.
-- ---------------------------------------------------------------------
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
  v_model     text := nullif(btrim(coalesce(p_payload->>'project_model', '')), '');
  v_cadence   text := nullif(btrim(coalesce(p_payload->>'cadence', '')), '');
  v_started   text := nullif(btrim(coalesce(p_payload->>'started_on', '')), '');
  v_ends      text := nullif(btrim(coalesce(p_payload->>'ends_on', '')), '');
  v_system    text := nullif(btrim(coalesce(p_payload->>'system_used', '')), '');
  v_pain      text := nullif(btrim(coalesce(p_payload->>'main_pain', '')), '');
  v_about     text := nullif(btrim(coalesce(p_payload->>'about', '')), '');
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
  -- Rate limit: 60 criações/min.
  select count(*) into v_recent
    from crm_intake_log
   where action = 'create'
     and received_at > now() - interval '1 minute';
  if v_recent >= 60 then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'rate_limited', 'Limite de requisições por minuto excedido.', 'rate_limited');
  end if;

  -- Número: obrigatório e inteiro positivo.
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

  -- Razão social: obrigatória.
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

  -- Enums opcionais.
  if v_model is not null and v_model not in ('bpo', 'consultoria') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Modelo de projeto inválido (bpo|consultoria).', 'refused_validation');
  end if;
  if v_cadence is not null and v_cadence not in
       ('semanal', 'quinzenal', 'semanal_quinzenal', 'quinzenal_semanal') then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Cadência inválida.', 'refused_validation');
  end if;

  -- Datas: texto AAAA-MM-DD válido; fim >= início.
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

  -- Textos livres: teto de tamanho.
  if coalesce(char_length(v_system), 0) > v_text_cap
     or coalesce(char_length(v_pain), 0) > v_text_cap
     or coalesce(char_length(v_about), 0) > v_text_cap then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'validation', 'Um dos textos excede 5000 caracteres.', 'refused_validation');
  end if;

  -- Marketplaces/serviços contratados: cada um dentro do enum contracted_service.
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

  -- Número já em uso no nome de outra empresa? Recusa.
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

  -- Duplicado FORTE por nome? Recusa (bloqueio é a decisão do Mauricio).
  select s.id, s.name, s.group_name, s.sim into v_hit
    from crm_similar_companies(v_razao, 0.80, 1) s
   where s.sim >= 0.80 or crm_core_name(s.name) = crm_core_name(v_razao)
   order by s.sim desc
   limit 1;
  if found then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'duplicate',
             'Já existe empresa muito parecida: "' || v_hit.name || '".',
             'refused_duplicate',
             jsonb_build_object('id', v_hit.id, 'name', v_hit.name,
                                'group', v_hit.group_name,
                                'similarity', round(v_hit.sim::numeric, 3)));
  end if;

  -- Grupo "On Boarding" (resolvido por nome).
  select id into v_group from company_groups where lower(name) = 'on boarding' limit 1;
  if v_group is null then
    return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
             'internal', 'Grupo "On Boarding" não encontrado.', 'error');
  end if;

  -- Monta o nome no padrão atual.
  v_name := v_number || '. ' || v_razao
            || case when v_contato is not null then ' (' || v_contato || ')' else '' end;

  -- Criação ATÔMICA. Subtransação: se qualquer passo falhar, nada é criado, e
  -- ainda assim conseguimos AUDITAR (o insert de log no handler persiste).
  begin
    insert into companies (name, group_id, created_by)
    values (v_name, v_group, null)
    returning id into v_company;

    -- Evento no histórico: veio do CRM comercial. Ator = sistema (null).
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (v_company, 'empresa_criada_crm',
            'Empresa criada a partir do CRM comercial',
            jsonb_build_object('number', v_number, 'source', p_source),
            null);

    -- Informações do cliente (dispara o gatilho informacoes_alteradas).
    insert into company_details
      (company_id, project_model, started_on, ends_on, cadence,
       system_used, main_pain, about)
    values
      (v_company,
       v_model::project_model,
       v_started_d, v_ends_d,
       v_cadence::contract_cadence,
       v_system, v_pain, v_about);

    -- Serviços contratados.
    if v_services is not null and array_length(v_services, 1) > 0 then
      insert into company_contracted_channels (company_id, channel)
      select v_company, x::contracted_service
        from unnest(v_services) as x
      on conflict (company_id, channel) do nothing;
    end if;

  exception
    when unique_violation then
      -- Corrida: nome idêntico criado em paralelo. Trata como duplicado.
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'duplicate',
               'Já existe empresa com este nome (' || v_name || ').',
               'refused_duplicate');
    when others then
      return crm_intake_refuse('create', p_source, v_ip_hash, v_log_num, v_razao, p_payload,
               'internal', 'Falha ao criar: ' || sqlerrm, 'error');
  end;

  -- Sucesso.
  insert into crm_intake_log
    (action, source, ip_hash, number, razao_social, result, reason, company_id, payload)
  values ('create', p_source, v_ip_hash, v_number, left(v_razao, 200),
          'created', 'Empresa criada em On Boarding', v_company, p_payload);

  return jsonb_build_object('ok', true, 'id', v_company, 'name', v_name);
end;
$$;

-- ---------------------------------------------------------------------
-- Concessões: SÓ o service_role chama as RPCs (porta de servidor atrás do
-- segredo). anon/authenticated NÃO podem — a chave anon é pública.
-- ---------------------------------------------------------------------
revoke all on function crm_intake_create(jsonb, text, text)          from public;
revoke all on function crm_intake_check_duplicate(text, text, text)  from public;
-- Helper de escrita no log: fechado ao público (só as RPCs definer o chamam,
-- por dentro, com o privilégio do dono).
revoke all on function crm_intake_refuse(text, text, text, integer, text, jsonb, text, text, text, jsonb) from public;
grant execute on function crm_intake_create(jsonb, text, text)         to service_role;
grant execute on function crm_intake_check_duplicate(text, text, text) to service_role;
