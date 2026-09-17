-- =====================================================================
-- Serviços contratados (antes "Marketplaces contratados")
-- =====================================================================
-- O campo de "Marketplaces contratados" da tela Informações do cliente virou
-- "Serviços contratados" e ganhou opções que NÃO são canais de venda:
-- Tráfego, Gestão de site e Desenvolvimento de site. Estes dois últimos entram
-- no lugar de "Site próprio" (que deixa de existir NESTE campo).
--
-- DECISÃO DE MODELAGEM: até aqui esta tabela REAPROVEITAVA o enum sales_channel
-- (compartilhado com o faturamento). Isso deixou de servir — os novos serviços
-- não são canais de receita e poluiriam a tela de Faturamento. Então o campo é
-- DESACOPLADO: ganha um enum PRÓPRIO (contracted_service). O faturamento fica
-- 100% intacto — sales_channel (incl. 'site_proprio') permanece como estava.
--
-- Como consequência do desacoplamento, o cruzamento "contratado × ativo no
-- faturamento" foi REMOVIDO da tela: o campo agora é uma lista simples do que
-- foi vendido, para todos os cargos.
--
-- As 2 linhas existentes com 'site_proprio' (WAGEN, MERCADO MULTIPEÇAS) são
-- REMOVIDAS (decisão do usuário: sem migração automática p/ gestão/desenvolvimento;
-- o admin re-seleciona manualmente quando quiser).
-- =====================================================================

-- Enum próprio dos serviços contratados. Marketplaces primeiro (mesma ordem de
-- sempre), depois os serviços. SEM 'site_proprio'.
create type contracted_service as enum (
  'mercado_livre',
  'shopee',
  'amazon',
  'trafego',
  'gestao_site',
  'desenvolvimento_site'
);

-- Remove as linhas 'site_proprio' — não têm correspondente no novo enum e não
-- há como saber se eram gestão ou desenvolvimento (decisão: remover).
delete from company_contracted_channels where channel = 'site_proprio';

-- Converte a coluna para o enum próprio. As linhas restantes (mercado_livre,
-- shopee, amazon) têm os mesmos rótulos textuais nos dois enums, então a
-- conversão via texto é segura.
alter table company_contracted_channels
  alter column channel type contracted_service
  using channel::text::contracted_service;

-- ---------------------------------------------------------------------
-- Recria a RPC de gravação: mesma assinatura (p_channels text[]), só muda o
-- cast dos canais para o enum próprio contracted_service. O resto é idêntico à
-- migration 0069.
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
