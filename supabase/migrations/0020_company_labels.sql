-- =====================================================================
-- CRM/Timer - Monvatti :: Etiquetas de empresa (Passo 20)
-- =====================================================================
-- Catálogo de etiquetas coloridas (labels) + relação M2M com empresas
-- (company_labels). As tarefas NÃO copiam etiquetas: herdam da empresa em
-- tempo real (a leitura junta company_labels por company_id). Assim marcar
-- uma etiqueta numa empresa reflete retroativamente em TODAS as tarefas dela.
-- =====================================================================

create table if not exists labels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  bg_color    text not null default '#2B333B',
  text_color  text not null default '#FFFFFF',
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists company_labels (
  company_id  uuid not null references companies(id) on delete cascade,
  label_id    uuid not null references labels(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (company_id, label_id)
);

create index if not exists idx_company_labels_company on company_labels(company_id);
create index if not exists idx_company_labels_label   on company_labels(label_id);

alter table labels         enable row level security;
alter table company_labels enable row level security;

-- LABELS: qualquer autenticado lê (necessário p/ renderizar herança no
-- colaborador); só admin gerencia o catálogo (como o de tarefas padrão).
drop policy if exists labels_select on labels;
create policy labels_select on labels for select
  using (auth.uid() is not null);

drop policy if exists labels_admin_all on labels;
create policy labels_admin_all on labels for all
  using (is_admin()) with check (is_admin());

-- COMPANY_LABELS: leitura por quem enxerga a empresa (admin, consultor dela,
-- colaborador com tarefa nela — mesma regra de companies_select). Escrita:
-- admin ou consultor da empresa.
drop policy if exists cl_select on company_labels;
create policy cl_select on company_labels for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

drop policy if exists cl_manage on company_labels;
create policy cl_manage on company_labels for all
  using (is_admin() or company_id in (select my_consultant_companies()))
  with check (is_admin() or company_id in (select my_consultant_companies()));

-- Etiqueta inicial "Ema".
insert into labels (name, bg_color, text_color)
select 'Ema', '#4A2882', '#FFFFFF'
where not exists (select 1 from labels where name = 'Ema');
