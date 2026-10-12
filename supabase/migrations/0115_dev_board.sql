-- =====================================================================
-- 0115 — Quadro "Desenvolvimento" (Etapa 1): etiquetas calculadas + visão
-- admin-only com grupos próprios, Status e histórico.
-- =====================================================================
-- Como os quadros CS e Tráfego, o Desenvolvimento é uma VISÃO sobre as MESMAS
-- empresas do quadro de Empresas (nada é copiado), mas com GRUPOS PRÓPRIOS
-- (dev_groups) e SEM nenhuma sincronização: toda movimentação é MANUAL.
--
-- Entra no quadro toda empresa com 'gestao_site' e/ou 'desenvolvimento_site' em
-- company_contracted_channels (ao vivo). Saiu do serviço → sai do quadro, dados
-- guardados; voltou → reaparece com os dados.
--
-- Esta etapa cria: 2 etiquetas calculadas (mesmo mecanismo da TRÁFEGO, 0107),
-- os grupos, o enum de Status, company_dev + dev_audit (append-only), a
-- correspondência status<->grupo (UM lugar), as 2 RPCs e dev_board(). Tudo
-- admin-only — a Etapa 4 (cargo "Desenvolvedor") vai AMPLIAR a checagem num
-- ponto só (dev_can_manage). A coluna Prazo (Etapa 2) será RECONSTRUÍDA a partir
-- deste histórico, então ele precisa ser completo e preciso.
--
-- Nada do Desenvolvimento vai para company_events, cs_audit nem traffic_audit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Duas etiquetas CALCULADAS a partir dos serviços contratados, no mesmo
--    mecanismo da TRÁFEGO (0107): a view company_effective_labels já une
--    company_contracted_channels.channel -> labels por derived_value, então basta
--    inserir os dois labels com derived_kind='contracted_service'. Cores
--    DISTINTAS das existentes (red/blue/teal/purple/orange): rosa e verde-escuro.
--    Empresa com os dois serviços mostra as duas (a view faz UNION).
-- ---------------------------------------------------------------------
insert into labels (name, bg_color, text_color, highlight, derived_kind, derived_value)
values
  ('GESTÃO DE SITE',          '#DB2777', '#FFFFFF', false, 'contracted_service', 'gestao_site'),
  ('DESENVOLVIMENTO DE SITE', '#15803D', '#FFFFFF', false, 'contracted_service', 'desenvolvimento_site');

-- ---------------------------------------------------------------------
-- 2) Grupos do Desenvolvimento (tabela PRÓPRIA). 6 linhas semeadas na ordem
--    pedida; sem tela de gestão de grupos nesta etapa. RLS admin-only (a Etapa 4
--    amplia a leitura para o cargo Desenvolvedor).
-- ---------------------------------------------------------------------
create table dev_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#64748B',
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

alter table dev_groups enable row level security;
create policy dev_groups_select on dev_groups
  for select using ((select is_admin()));
create policy dev_groups_write on dev_groups
  for all using ((select is_admin())) with check ((select is_admin()));

insert into dev_groups (name, color, position) values
  ('Lista de Espera',    '#64748B', 1),  -- cinza
  ('Em Desenvolvimento', '#3145FF', 2),  -- azul
  ('Gestão de Site',     '#0D9488', 3),  -- verde-azulado
  ('Projeto Entregue',   '#22C55E', 4),  -- verde
  ('Projeto Pausado',    '#F59E0B', 5),  -- âmbar
  ('Cancelado',          '#EF4444', 6);  -- vermelho

-- ---------------------------------------------------------------------
-- 3) Enum de Status (escolha única). Valores internos em snake_case; os rótulos
--    e cores moram no front (lib/dev-options.ts). NÃO existe "Urgente".
--      lista_espera           -> "Lista de Espera"
--      aguardando_formulario  -> "Aguardando Formulário"
--      formulario_incompleto  -> "Formulário Incompleto"
--      em_desenvolvimento     -> "Em Desenvolvimento"
--      entregue               -> "Entregue"
--      pendencia_cliente      -> "Pendência Cliente"
--      pausado                -> "Pausado"
--      cancelado              -> "Cancelado"
--      gestao_site            -> "Gestão de site"
-- ---------------------------------------------------------------------
create type dev_status as enum (
  'lista_espera',
  'aguardando_formulario',
  'formulario_incompleto',
  'em_desenvolvimento',
  'entregue',
  'pendencia_cliente',
  'pausado',
  'cancelado',
  'gestao_site'
);

-- ---------------------------------------------------------------------
-- 4) Dados do Desenvolvimento por empresa. UMA linha por empresa. Empresa SEM
--    linha = Lista de Espera / lista_espera (padrão calculado em dev_board e nas
--    RPCs). A linha nasce no primeiro movimento ou troca de status (upsert de UM
--    comando). group_id NOT NULL (o movimento sempre resolve um grupo).
--    Os dados ficam guardados mesmo quando a empresa SAI do quadro (perde os
--    serviços de site); se voltar, reaparecem — por isso nada aqui é apagado na
--    saída. updated_by é uuid SEM FK de propósito (igual ao CS/Tráfego): não pode
--    quebrar se um perfil for removido; o nome é resolvido ao vivo.
-- ---------------------------------------------------------------------
create table company_dev (
  company_id uuid primary key references companies(id) on delete cascade,
  group_id   uuid not null references dev_groups(id),
  status     dev_status not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table company_dev enable row level security;
create policy company_dev_all on company_dev
  for all using ((select is_admin())) with check ((select is_admin()));

-- ---------------------------------------------------------------------
-- 5) Histórico (append-only), no mesmo molde do cs_audit/traffic_audit: genérico
--    por `field`; a Etapa 2 acrescentará 'pausa_manual' sem mudar o schema.
--    changed_by nulo = "Sistema". NENHUMA policy de escrita — só o gatilho
--    (definer) grava. Registra TODA mudança de grupo e de status, inclusive a
--    criação da linha (old_value = padrão calculado).
--      field ∈ ('grupo', 'status')
--      grupo:  old/new guardam o NOME do grupo no momento (self-contained).
--      status: guarda o valor do enum (texto); rótulo no front.
-- ---------------------------------------------------------------------
create table dev_audit (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  field      text not null,
  old_value  text,
  new_value  text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index dev_audit_company_idx on dev_audit (company_id, changed_at desc, id desc);

alter table dev_audit enable row level security;
create policy dev_audit_select on dev_audit
  for select using ((select is_admin()));

-- ---------------------------------------------------------------------
-- 6) Checagem de acesso CENTRALIZADA num ponto só (a Etapa 4 amplia ESTA função
--    para incluir o cargo "Desenvolvedor"). Usada pela leitura (dev_board) e
--    pela escrita (RPCs). Nesta etapa: só admin.
-- ---------------------------------------------------------------------
create or replace function dev_can_manage()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select (select is_admin());
$$;
grant execute on function dev_can_manage() to authenticated;

-- A empresa está no quadro (contratou serviço de site)? SECURITY DEFINER para a
-- Etapa 4 (o cargo Desenvolvedor não lê company_contracted_channels). Booleano
-- por empresa, sem vazamento.
create or replace function dev_on_board(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from company_contracted_channels
     where company_id = p_company_id
       and channel in ('gestao_site', 'desenvolvimento_site')
  );
$$;
grant execute on function dev_on_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Correspondência Status <-> Grupo em UM lugar só (função SQL), usada pelas
--    DUAS RPCs — nada de duplicar no front. Por NOME do grupo (os ids são
--    gerados). Os três status que NÃO movem (aguardando_formulario,
--    formulario_incompleto, pendencia_cliente) não aparecem aqui.
-- ---------------------------------------------------------------------
create or replace function dev_status_group_pairs()
returns table(status dev_status, group_name text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('lista_espera'::dev_status,       'Lista de Espera'::text),
    ('em_desenvolvimento'::dev_status, 'Em Desenvolvimento'),
    ('gestao_site'::dev_status,        'Gestão de Site'),
    ('entregue'::dev_status,           'Projeto Entregue'),
    ('pausado'::dev_status,            'Projeto Pausado'),
    ('cancelado'::dev_status,          'Cancelado')
  ) as t(status, group_name);
$$;
grant execute on function dev_status_group_pairs() to authenticated;

-- Grupo correspondente a um status (NULL = status que NÃO move: a empresa fica
-- no grupo atual).
create or replace function dev_group_for_status(p_status dev_status)
returns uuid
language sql
stable
set search_path = public
as $$
  select g.id
    from dev_status_group_pairs() p
    join dev_groups g on g.name = p.group_name
   where p.status = p_status;
$$;
grant execute on function dev_group_for_status(dev_status) to authenticated;

-- Status correspondente a um grupo de destino (os 6 grupos têm um; grupo
-- desconhecido -> NULL).
create or replace function dev_status_for_group(p_group_id uuid)
returns dev_status
language sql
stable
set search_path = public
as $$
  select p.status
    from dev_status_group_pairs() p
    join dev_groups g on g.name = p.group_name
   where g.id = p_group_id;
$$;
grant execute on function dev_status_for_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Gatilho de auditoria (AFTER, SECURITY DEFINER). Um registro por campo
--    alterado; mudança que não altera o valor não registra. Status que move de
--    grupo gera DOIS registros (status e grupo) com o MESMO changed_at (v_now).
--    GUARD de cascade reaproveitando company_exists() (0079): na exclusão da
--    empresa a cascata apaga esta linha e o gatilho sairia tentando gravar num
--    company_id já removido (a FK recusaria) — o guard sai sem gravar.
-- ---------------------------------------------------------------------
create or replace function company_dev_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid := auth.uid();
  v_now            timestamptz := now();
  v_default_status dev_status := 'lista_espera';
  v_lista          uuid;
begin
  select id into v_lista from dev_groups where name = 'Lista de Espera';

  if tg_op = 'INSERT' then
    -- Criação da linha: old = padrão calculado (lista_espera / 'Lista de Espera').
    if new.status is distinct from v_default_status then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'status', v_default_status::text, new.status::text, v_actor, v_now);
    end if;
    if new.group_id is distinct from v_lista then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'grupo',
              (select name from dev_groups where id = v_lista),
              (select name from dev_groups where id = new.group_id),
              v_actor, v_now);
    end if;
    return null;

  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'status', old.status::text, new.status::text, v_actor, v_now);
    end if;
    if new.group_id is distinct from old.group_id then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (new.company_id, 'grupo',
              (select name from dev_groups where id = old.group_id),
              (select name from dev_groups where id = new.group_id),
              v_actor, v_now);
    end if;
    return null;

  else -- DELETE (na prática só via cascade da exclusão da empresa)
    if not company_exists(old.company_id) then
      return null; -- cascade da exclusão da empresa: nada a gravar
    end if;
    -- Exclusão manual da linha: volta ao padrão calculado.
    if old.status is distinct from v_default_status then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (old.company_id, 'status', old.status::text, v_default_status::text, v_actor, v_now);
    end if;
    if old.group_id is distinct from v_lista then
      insert into dev_audit (company_id, field, old_value, new_value, changed_by, changed_at)
      values (old.company_id, 'grupo',
              (select name from dev_groups where id = old.group_id),
              (select name from dev_groups where id = v_lista),
              v_actor, v_now);
    end if;
    return null;
  end if;
end;
$$;

create trigger company_dev_audit_trg
  after insert or update or delete on company_dev
  for each row execute function company_dev_audit();

-- ---------------------------------------------------------------------
-- 9) RPCs de escrita (SECURITY INVOKER; a RLS admin-only de company_dev é a
--    barreira real + o guard dev_can_manage()). Cada uma: recusa quem não pode,
--    recusa empresa fora do quadro, UM comando de escrita (upsert). A
--    correspondência status<->grupo vem SÓ das funções do item 7.
-- ---------------------------------------------------------------------

-- Troca o Status. Status que move (dev_group_for_status <> null) troca o grupo;
-- os que não movem mantêm o grupo atual (ou o padrão calculado se não há linha).
create or replace function dev_set_status(p_company_id uuid, p_status dev_status)
returns void
language plpgsql
security invoker
set search_path = public
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
  v_current_group := coalesce(v_current_group, v_lista);  -- padrão calculado

  v_target_group := coalesce(dev_group_for_status(p_status), v_current_group);

  insert into company_dev (company_id, group_id, status, updated_at, updated_by)
  values (p_company_id, v_target_group, p_status, now(), auth.uid())
  on conflict (company_id) do update
    set group_id = excluded.group_id, status = excluded.status,
        updated_at = now(), updated_by = auth.uid();
end;
$$;
grant execute on function dev_set_status(uuid, dev_status) to authenticated;

-- Move de grupo (arraste ou "Mover para..."). Troca o status para o status
-- correspondente ao grupo de destino.
create or replace function dev_move_company(p_company_id uuid, p_dev_group_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
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

-- ---------------------------------------------------------------------
-- 10) dev_board() — uma linha por empresa COM serviço de site. SECURITY DEFINER,
--     search_path fixo, raise para quem não pode gerir (a Etapa 4 amplia via
--     dev_can_manage). Entrega TUDO pronto: grupo RESOLVIDO (com o padrão Lista
--     de Espera), status (com o padrão lista_espera), etiquetas efetivas e a
--     contagem de histórico. Ordem por nome (a mesma do quadro de Empresas).
-- ---------------------------------------------------------------------
create or replace function dev_board()
returns table (
  id            uuid,
  name          text,
  group_id      uuid,
  status        text,
  labels        jsonb,
  history_count integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lista uuid;
begin
  if not dev_can_manage() then
    raise exception 'Apenas administradores acessam o quadro de Desenvolvimento.'
      using errcode = 'insufficient_privilege';
  end if;
  select dg.id into v_lista from dev_groups dg where dg.name = 'Lista de Espera';
  return query
  with hist as (
    select company_id, count(*)::int as n from dev_audit group by company_id
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
    c.id,
    c.name,
    coalesce(cd.group_id, v_lista),
    coalesce(cd.status, 'lista_espera'::dev_status)::text,
    coalesce(lbl.items, '[]'::jsonb),
    coalesce(h.n, 0)
  from companies c
  left join company_dev cd on cd.company_id = c.id
  left join hist h on h.company_id = c.id
  left join lbl on lbl.company_id = c.id
  where exists (
    select 1 from company_contracted_channels cc
     where cc.company_id = c.id
       and cc.channel in ('gestao_site', 'desenvolvimento_site')
  )
  order by c.name;
end;
$$;
grant execute on function dev_board() to authenticated;
