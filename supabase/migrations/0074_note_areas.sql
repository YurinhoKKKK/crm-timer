-- =====================================================================
-- CRM/Timer - Monvatti :: Área das atualizações da empresa
-- =====================================================================
-- Toda atualização (company_notes) passa a indicar a que ÁREA do trabalho ela
-- se refere: Mercado Livre, Amazon, Shopee, ERP, Site, Tráfego ou Outros.
--
-- Uma atualização pode ter VÁRIAS áreas (M:N em company_note_areas). A
-- obrigatoriedade de pelo menos uma área é imposta na TELA (só para o que for
-- criado/editado daqui em diante) — NÃO no banco: as 6 atualizações antigas
-- ficam legitimamente "sem área" e podem ser editadas depois. Não há backfill.
--
-- IMPORTANTE: isto NÃO é canal de venda. O enum note_area é uma taxonomia
-- própria, separada de propósito do sales_channel (faturamento) e do
-- listing_marketplace (listagens). São conceitos diferentes; misturá-los
-- recriaria a confusão entre canal contratado e canal operante que já evitamos.
-- =====================================================================

create type note_area as enum ('ml', 'amz', 'shp', 'erp', 'site', 'trafego', 'outros');

create table company_note_areas (
  note_id uuid not null references company_notes(id) on delete cascade,
  area    note_area not null,
  primary key (note_id, area)
);

-- Leitura por nota (montar as etiquetas de cada atualização) e filtro por área.
create index idx_company_note_areas_area on company_note_areas(area);

-- ---------------------------------------------------------------------
-- RLS: espelha exatamente o escopo das atualizações (cn_* na 0024). A área é
-- um atributo da nota — quem pode ler/editar a nota pode ler/editar as áreas
-- dela. Toda regra é derivada do registro pai em company_notes.
--   - leitura: quem alcança a empresa da nota (admin; consultor na carteira;
--     colaborador nas empresas onde tem tarefa).
--   - escrita (insert/delete, usados ao criar e ao reeditar as áreas): só o
--     AUTOR da nota (ainda com acesso à empresa) ou admin.
-- ---------------------------------------------------------------------
alter table company_note_areas enable row level security;

create policy cna_select on company_note_areas for select
  using (
    exists (
      select 1 from company_notes n
      where n.id = note_id
        and (
          is_admin()
          or n.company_id in (select my_consultant_companies())
          or n.company_id in (select my_collaborator_companies())
        )
    )
  );

create policy cna_insert on company_note_areas for insert
  with check (
    exists (
      select 1 from company_notes n
      where n.id = note_id
        and (
          is_admin()
          or (
            n.author_id = auth.uid()
            and (
              n.company_id in (select my_consultant_companies())
              or n.company_id in (select my_collaborator_companies())
            )
          )
        )
    )
  );

create policy cna_delete on company_note_areas for delete
  using (
    exists (
      select 1 from company_notes n
      where n.id = note_id
        and (
          is_admin()
          or (
            n.author_id = auth.uid()
            and (
              n.company_id in (select my_consultant_companies())
              or n.company_id in (select my_collaborator_companies())
            )
          )
        )
    )
  );
