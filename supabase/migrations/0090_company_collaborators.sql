-- =====================================================================
-- MUDANÇA DE ÂNCORA: colaborador responsável passa a ser VÍNCULO DECLARADO na
-- empresa, e não consequência de ter tarefa atribuída.
--
-- Até aqui o colaborador "alcançava" uma empresa por ter task_instance nela
-- (my_collaborator_companies derivava das tarefas). Isso deixava vazar acesso:
-- bastava alguém criar uma tarefa para a pessoa. Agora a responsabilidade é
-- explícita, gerida pelo admin em "Editar empresa" — no mesmo molde de
-- company_consultants.
--
-- DECISÕES (travadas):
--  · Tabela ACEITA mais de um colaborador por empresa (a divisão por
--    especialidade pode voltar) — nada de unicidade.
--  · Qualquer cargo pode ser vinculado (há consultores/admins que executam).
--  · Só ADMIN adiciona/remove (no banco e no servidor). Consultor NÃO.
--  · Leitura: quem já ALCANÇA a empresa (admin, consultor da empresa,
--    colaborador da empresa, ou a própria pessoa vinculada).
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABELA — molde de company_consultants (PK composta, cascade na empresa e no
-- perfil).
-- ---------------------------------------------------------------------
create table if not exists company_collaborators (
  company_id      uuid not null references companies(id) on delete cascade,
  collaborator_id uuid not null references profiles(id)  on delete cascade,
  assigned_at     timestamptz not null default now(),
  primary key (company_id, collaborator_id)
);

create index if not exists idx_company_collaborators_collaborator
  on company_collaborators(collaborator_id);

-- ---------------------------------------------------------------------
-- ÂNCORA: my_collaborator_companies() passa a ser o VÍNCULO DECLARADO UNIÃO as
-- empresas onde a pessoa ainda tem tarefa (para não sumir trabalho em aberto e
-- preservar a leitura de quem já executava). É SUPERCONJUNTO do critério antigo
-- — nenhum acesso de leitura é perdido; ganha-se a empresa vinculada mesmo sem
-- tarefa. SECURITY DEFINER: lê as tabelas-base direto (sem recursão de RLS).
-- ---------------------------------------------------------------------
create or replace function my_collaborator_companies()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select company_id from company_collaborators where collaborator_id = auth.uid()
  union
  select distinct company_id from task_instances where collaborator_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- RLS: leitura para quem alcança a empresa; escrita SÓ admin.
-- ---------------------------------------------------------------------
alter table company_collaborators enable row level security;

create policy ccol_select on company_collaborators for select
  using (
    is_admin()
    or collaborator_id = auth.uid()
    or company_id in (select my_consultant_companies())
    or company_id in (select my_collaborator_companies())
  );

create policy ccol_admin_all on company_collaborators for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- BACKFILL — critério EXATO (conferido no banco): vincula os colaboradores
-- responsáveis por TAREFA PADRÃO ATIVA, ou seja, task_templates com
-- active = true, standard_task_id NÃO NULO e collaborator_id não nulo.
-- É SÓ o que vem do CATÁLOGO de Tarefas Padrão: tarefa avulsa (standard_task_id
-- nulo) é trabalho pontual, não responsabilidade permanente, e NÃO entra.
-- Idempotente (on conflict do nothing).
-- ---------------------------------------------------------------------
insert into company_collaborators (company_id, collaborator_id)
select distinct company_id, collaborator_id
  from task_templates
 where active = true
   and standard_task_id is not null
   and collaborator_id is not null
on conflict (company_id, collaborator_id) do nothing;

-- ---------------------------------------------------------------------
-- PAINEL DO COLABORADOR — lista as empresas em que ele é RESPONSÁVEL (carteira),
-- e não mais toda empresa em que tem tarefa. EXCEÇÃO para não sumir trabalho:
-- empresa em que ele tenha tarefa EM ABERTO (a_fazer/iniciada) continua
-- aparecendo mesmo sem vínculo, marcada como FORA DA CARTEIRA (in_portfolio =
-- false). Empresa só com tarefa já concluída e sem vínculo NÃO aparece.
--
-- Contagens agregadas NO BANCO (nunca contando linhas em JS — PostgREST trunca
-- em 1000). Mesmas definições de company_task_counts. SECURITY INVOKER: a RLS
-- escopa o que a pessoa alcança; a página sempre passa o próprio id.
-- ---------------------------------------------------------------------
create or replace function collaborator_portfolio(p_collaborator uuid)
returns table (
  company_id   uuid,
  company_name text,
  in_portfolio boolean,
  total        bigint,
  done         bigint,
  pending      bigint,
  overdue      bigint,
  due_soon     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    -- carteira declarada (aparece mesmo com zero tarefa)
    select company_id, true as in_portfolio
      from company_collaborators
     where collaborator_id = p_collaborator
    union all
    -- exceção: empresa com tarefa EM ABERTO da pessoa
    select distinct company_id, false
      from task_instances
     where collaborator_id = p_collaborator
       and status in ('a_fazer', 'iniciada')
  ),
  base2 as (
    select company_id, bool_or(in_portfolio) as in_portfolio
      from base
     group by company_id
  ),
  counts as (
    select ti.company_id,
           count(*) as total,
           count(*) filter (where ti.status = 'finalizada') as done,
           count(*) filter (where ti.status not in ('finalizada', 'cancelada')) as pending,
           count(*) filter (
             where ti.status not in ('finalizada', 'cancelada') and ti.due_at < now()
           ) as overdue,
           count(*) filter (
             where ti.status not in ('finalizada', 'cancelada')
               and ti.due_at >= now()
               and ti.due_at < now() + interval '24 hours'
           ) as due_soon
      from task_instances ti
     where ti.collaborator_id = p_collaborator
     group by ti.company_id
  )
  select b.company_id,
         c.name,
         b.in_portfolio,
         coalesce(ct.total, 0),
         coalesce(ct.done, 0),
         coalesce(ct.pending, 0),
         coalesce(ct.overdue, 0),
         coalesce(ct.due_soon, 0)
    from base2 b
    left join companies c on c.id = b.company_id
    left join counts ct on ct.company_id = b.company_id;
$$;

grant execute on function collaborator_portfolio(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Contagem de tarefas EM ABERTO de um colaborador numa empresa — usada ao
-- REMOVER um vínculo (o admin é avisado de quantas tarefas ficarão sem vínculo
-- antes de confirmar). Não bloqueia nada; é só informação. SECURITY INVOKER
-- (a RLS já garante que só admin/quem alcança lê essas instâncias).
-- ---------------------------------------------------------------------
create or replace function collaborator_open_task_count(
  p_company uuid, p_collaborator uuid
) returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
    from task_instances
   where company_id = p_company
     and collaborator_id = p_collaborator
     and status in ('a_fazer', 'iniciada');
$$;

grant execute on function collaborator_open_task_count(uuid, uuid) to authenticated;
