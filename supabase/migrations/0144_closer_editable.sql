-- =====================================================================
-- 0144 — Closer editável nas Informações do cliente + sugestões
-- =====================================================================
-- O Closer (company_details.closer_name) era SOMENTE LEITURA: gravado uma única
-- vez pelo intake do CRM comercial (0097) e nunca mais tocado. Passa a ser
-- EDITÁVEL no formulário de Informações do cliente, com a MESMA permissão dos
-- demais campos dessa aba (só admin, via RLS cd_update — SEM mudança de RLS).
--
-- DECISÕES (não reabrir):
--  1) Editável no formulário de edição; permissão = a de hoje (só admin, RLS).
--  2) Texto livre, trim, máx. 200 (mesmo teto do intake). Vazio → null.
--  3) Autocomplete sugere os closers JÁ existentes (distinct, sem nulos) para
--     evitar o mesmo vendedor em grafias diferentes. Sugestão, não trava.
--  4) O intake (crm_intake_create) segue IGUAL (grava na criação). Nenhum outro
--     fluxo sobrescreve closer_name. O snapshot de churn (company_churns.
--     seller_name) é OUTRO campo e NÃO muda (tem edição própria no Churn).
--
-- Mudanças:
--  A) company_details_save ganha p_closer_name (a tela grava o Closer junto).
--     SECURITY INVOKER — a RLS (cd_update is_admin()) segue sendo a fronteira.
--  B) closer_names_list(): distinct dos closers já cadastrados, para o
--     autocomplete. INVOKER (respeita cd_select; admin vê todos). Sem RLS nova.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) company_details_save — agora com p_closer_name (último argumento).
--    Deriva da versão viva (0107): sem etiqueta automática, canais em
--    contracted_service. Único acréscimo: grava closer_name (insert + update).
--    Trim + vazio→null; o teto de 200 é validado na action (igual aos demais
--    textos, cujo teto também mora só na action). A RLS continua sendo o gate.
--
--    PURAMENTE ADITIVO (zero downtime): esta é uma NOVA sobrecarga (10 args). A
--    de 9 args (0107, sem closer) é mantida de propósito — a Supabase é
--    compartilhada entre produção e dev, e o app de produção ainda chama a de 9
--    args até o deploy do código novo. PostgREST escolhe a sobrecarga pelo
--    conjunto de argumentos nomeados, então as duas convivem sem ambiguidade; a
--    de 9 args fica órfã após o deploy e pode ser removida numa migration futura.
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
  p_channels      text[],
  p_closer_name   text
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
  v_closer  text := nullif(btrim(coalesce(p_closer_name, '')), '');
begin
  insert into company_details
    (company_id, project_model, started_on, ends_on, cadence,
     system_used, main_pain, about, closer_name)
  values
    (p_company, v_model, p_started_on, p_ends_on, v_cadence,
     v_system, v_pain, v_about, v_closer)
  on conflict (company_id) do update set
    project_model = excluded.project_model,
    started_on    = excluded.started_on,
    ends_on       = excluded.ends_on,
    cadence       = excluded.cadence,
    system_used   = excluded.system_used,
    main_pain     = excluded.main_pain,
    about         = excluded.about,
    closer_name   = excluded.closer_name;  -- trigger carimba updated_*

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
  uuid, text, date, date, text, text, text, text, text[], text
) to authenticated;

-- ---------------------------------------------------------------------
-- B) closer_names_list() — distinct dos closers já cadastrados, para o
--    autocomplete do campo Closer. Nomes não nulos, trimados, ordenados.
--    SECURITY INVOKER: respeita a RLS cd_select (admin vê todos; consultor/
--    colaborador, só o que alcançam). Na prática só o admin abre a edição.
-- ---------------------------------------------------------------------
create or replace function closer_names_list()
returns setof text
language sql stable security invoker set search_path = public
as $$
  select distinct btrim(closer_name)
    from company_details
   where closer_name is not null
     and btrim(closer_name) <> ''
   order by 1;
$$;

grant execute on function closer_names_list() to authenticated;
