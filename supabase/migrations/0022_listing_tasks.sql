-- =====================================================================
-- CRM/Timer - Monvatti :: Passo 22 — novo tipo de tarefa "Listagem de marcas"
-- =====================================================================
-- Uma "listagem de marcas" é uma tarefa PONTUAL (não tem única/diária): o
-- consultor/admin registra quais marcas pesquisar, em quais marketplaces, e
-- se precisa de cálculo de margem (com a alíquota de imposto do cliente). O
-- sistema apenas ARMAZENA — não calcula nada; o cálculo é feito por fora.
--
-- MODELAGEM (flag no template + tabela de marcas):
-- - Reaproveitamos toda a maquinaria existente: uma listagem grava kind='unica'
--   (pontual), então o trigger trg_unique_template já cria a task_instance na
--   hora, com due_at no fuso de Brasília (migration 0019). Nada de trigger novo.
-- - Uma coluna template_type ('padrao' | 'listagem') distingue o tipo de fato,
--   sem poluir o enum task_kind (que continua só única/diária).
-- - Campos próprios da listagem ficam no template; as marcas, por serem várias,
--   vão numa tabela filha (listing_brands).
-- =====================================================================

-- Novo enum de tipo de template (extensível se surgirem outros tipos especiais).
create type template_type as enum ('padrao', 'listagem');

-- Marketplaces onde a pesquisa pode ser feita.
create type listing_marketplace as enum ('mercado_livre', 'shopee', 'amazon');

-- ---------------------------------------------------------------------
-- Colunas de listagem no template
-- ---------------------------------------------------------------------
alter table task_templates
  add column template_type        template_type not null default 'padrao',
  add column listing_needs_margin boolean       not null default false,
  add column listing_tax_rate     numeric(5,2),
  add column listing_marketplaces listing_marketplace[] not null default '{}';

-- Alíquota só faz sentido entre 0 e 100 (percentual).
alter table task_templates
  add constraint task_templates_listing_tax_rate_range
  check (listing_tax_rate is null or (listing_tax_rate >= 0 and listing_tax_rate <= 100));

-- ---------------------------------------------------------------------
-- Marcas da listagem (uma listagem tem várias marcas)
-- ---------------------------------------------------------------------
create table listing_brands (
  id          uuid primary key default uuid_generate_v4(),
  template_id uuid not null references task_templates(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,   -- ordem em que o usuário as adicionou
  created_at  timestamptz not null default now()
);

create index idx_listing_brands_template on listing_brands(template_id);

-- ---------------------------------------------------------------------
-- RLS: as marcas herdam a visibilidade/gestão do template a que pertencem.
-- A subconsulta em task_templates já é filtrada pela RLS dele (tt_select),
-- então "template visível" = "marcas visíveis". Para gestão, restringimos a
-- admin e ao consultor da empresa (mesma regra do tt_manage).
-- ---------------------------------------------------------------------
alter table listing_brands enable row level security;

create policy lb_select on listing_brands for select
  using (template_id in (select id from task_templates));

create policy lb_manage on listing_brands for all
  using (
    template_id in (
      select id from task_templates
      where is_admin() or company_id in (select my_consultant_companies())
    )
  )
  with check (
    template_id in (
      select id from task_templates
      where is_admin() or company_id in (select my_consultant_companies())
    )
  );
