-- =====================================================================
-- Informações do cliente (tela própria dentro da página da empresa)
-- =====================================================================
-- Uma tela de leitura por padrão (edição só admin) com os dados COMERCIAIS /
-- de RELACIONAMENTO do cliente: modelo do projeto, período do contrato,
-- cadência de contato, sistema utilizado, maior dor, um "sobre" livre e os
-- MARKETPLACES CONTRATADOS.
--
-- QUEM VÊ: quem já ALCANÇA a empresa hoje — admin (todas), consultor da
-- carteira (my_consultant_companies) e colaborador com tarefa na empresa
-- (my_collaborator_companies, vínculo derivado). Mesmo predicado de leitura de
-- company_notes (cn_select). anon NUNCA. O PORTAL DO CLIENTE não é tocado.
--
-- QUEM EDITA: SÓ admin (is_admin()), reforçado no banco — consultor e
-- colaborador não escrevem nem por query direta.
--
-- DECISÕES DE MODELAGEM (ver docs/ESPECIFICACAO.md):
--  · project_model é campo NOVO e INDEPENDENTE da etiqueta CONSULTORIA/BPO
--    (duplicidade aceita conscientemente; não sincroniza nem migra etiquetas).
--  · Os MARKETPLACES CONTRATADOS (o que foi VENDIDO) são propositalmente
--    DIFERENTES de company_sales_channels (o que já COMEÇOU no faturamento).
--    NÃO unificar nem sincronizar as duas tabelas. Reusa o enum sales_channel.
--  · DATAS puras: só started_on/ends_on; duração e dias restantes são
--    CALCULADOS (guardar os dois convidaria à divergência). Tipo DATE, sem fuso.
-- =====================================================================

-- Modelo do projeto (campo próprio; NÃO é a etiqueta).
create type project_model as enum ('bpo', 'consultoria');

-- Cadência de contato com o cliente.
create type contract_cadence as enum (
  'semanal',
  'quinzenal',
  'semanal_quinzenal',
  'quinzenal_semanal'
);

-- ---------------------------------------------------------------------
-- Uma linha por empresa. Todos os campos são opcionais (a tela mostra
-- "não informado" para o que estiver vazio).
-- ---------------------------------------------------------------------
create table company_details (
  company_id    uuid primary key references companies(id) on delete cascade,
  project_model project_model,
  started_on    date,
  ends_on       date,
  cadence       contract_cadence,
  system_used   text,          -- texto livre, campo grande
  main_pain     text,          -- texto livre
  about         text,          -- texto livre
  updated_at    timestamptz not null default now(),
  updated_by    uuid references profiles(id),
  -- Fim não pode ser antes do início (quando ambos existem).
  check (ends_on is null or started_on is null or ends_on >= started_on)
);

-- ---------------------------------------------------------------------
-- Marketplaces CONTRATADOS (o que foi vendido no contrato). Reusa o enum
-- sales_channel. DIFERENTE de company_sales_channels (canais já ativos no
-- faturamento) — de propósito: a Monvatti inicia pelo canal principal e ativa
-- os demais depois. Desmarcar aqui (cliente desistiu) NÃO afeta o histórico de
-- faturamento (tabelas separadas, sem cascade entre elas).
-- ---------------------------------------------------------------------
create table company_contracted_channels (
  company_id uuid not null references companies(id) on delete cascade,
  channel    sales_channel not null,
  primary key (company_id, channel)
);

-- ---------------------------------------------------------------------
-- Trigger: carimba updated_at/updated_by em insert e update, e congela a
-- identidade da linha (ninguém reescreve company_id por baixo numa edição).
-- ---------------------------------------------------------------------
create or replace function company_details_touch()
returns trigger
language plpgsql security invoker set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_company_details_touch
  before insert or update on company_details
  for each row execute function company_details_touch();

-- ---------------------------------------------------------------------
-- RLS — leitura para quem alcança a empresa; escrita SÓ admin.
-- ---------------------------------------------------------------------
alter table company_details             enable row level security;
alter table company_contracted_channels enable row level security;

-- company_details
create policy cd_select on company_details for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

create policy cd_insert on company_details for insert
  with check (is_admin());

create policy cd_update on company_details for update
  using (is_admin())
  with check (is_admin());

create policy cd_delete on company_details for delete
  using (is_admin());

-- company_contracted_channels
create policy ccc_select on company_contracted_channels for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

create policy ccc_insert on company_contracted_channels for insert
  with check (is_admin());

create policy ccc_delete on company_contracted_channels for delete
  using (is_admin());
-- (sem UPDATE: linha de canal é presença/ausência; muda por insert/delete.)

-- ---------------------------------------------------------------------
-- Grava a tela inteira de uma vez (detalhes + canais contratados), atômico.
--
-- SECURITY INVOKER: a RLS é a fronteira real — se o usuário não for admin, o
-- INSERT/UPDATE em company_details levanta 42501 (with_check is_admin()) e a
-- action traduz para um aviso. Consultor/colaborador não escrevem nem por aqui.
--
-- Datas chegam como DATE (data pura). Enums chegam como texto (vazio → null).
-- p_channels: text[] com os canais contratados; sincroniza a tabela filha
-- (remove os que saíram, insere os novos) sem tocar em company_sales_channels.
-- ---------------------------------------------------------------------
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

  -- Sincroniza os canais contratados: remove os que saíram, insere os novos.
  delete from company_contracted_channels
   where company_id = p_company
     and channel <> all (
       select c::sales_channel
         from unnest(coalesce(p_channels, '{}')) as c
     );

  insert into company_contracted_channels (company_id, channel)
  select p_company, c::sales_channel
    from unnest(coalesce(p_channels, '{}')) as c
  on conflict (company_id, channel) do nothing;
end;
$$;

grant execute on function company_details_save(
  uuid, text, date, date, text, text, text, text, text[]
) to authenticated;
