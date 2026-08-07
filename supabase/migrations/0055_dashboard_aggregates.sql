-- =====================================================================
-- Correção: os números dos painéis são AGREGADOS NO BANCO, nunca contando
-- linhas em JavaScript.
-- =====================================================================
-- BUG (materializado no dashboard do admin): a tela buscava TODAS as
-- task_instances e agregava (contagens por status, atrasadas, resumo por
-- responsável) em JS. O PostgREST devolve no máximo 1000 linhas por padrão e
-- TRUNCA sem erro nem aviso. Passando de 1000 tarefas, os cards mostravam
-- números MENORES que a verdade — e um recorte curto (ex.: 30 dias, < 1000
-- linhas) podia exibir MAIS que o "Tudo" truncado, o que é impossível.
--
-- Estas RPCs fazem count(*) no banco, sem teto de linhas. Mesmo desenho de
-- company_overview (passo 32.3): contagens/atrasadas por task_date/due_at; o
-- TEMPO continua vindo das RPCs time_by_* (time_entries por started_at BRT),
-- que já agregam no banco. SECURITY INVOKER: a RLS ti_select escopa por cargo
-- (admin tudo; consultor suas empresas; colaborador o próprio) — sem
-- service_role. p_start null = todo o período.
-- =====================================================================

-- Contagens globais por status + atrasadas, no banco. p_collaborator opcional
-- restringe a um responsável (tela de detalhe do colaborador). Uma linha só.
create or replace function task_status_counts(
  p_start date, p_collaborator uuid default null
) returns table (
  total bigint, a_fazer bigint, iniciada bigint, finalizada bigint,
  cancelada bigint, overdue bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*),
    count(*) filter (where status = 'a_fazer'),
    count(*) filter (where status = 'iniciada'),
    count(*) filter (where status = 'finalizada'),
    count(*) filter (where status = 'cancelada'),
    count(*) filter (where status in ('a_fazer', 'iniciada') and due_at < now())
  from task_instances
  where (p_start is null or task_date >= p_start)
    and (p_collaborator is null or collaborator_id = p_collaborator);
$$;

-- Contagens por responsável (total/concluídas) no período, no banco. Alimenta o
-- "Resumo por responsável" do dashboard; o TEMPO por responsável vem de
-- time_by_collaborator. Só volta quem tem tarefa DATADA no período — quem
-- trabalhou no período em tarefa fora dele entra pelo tempo (união feita no
-- servidor, como já era).
create or replace function collaborator_task_counts(
  p_start date
) returns table (collaborator_id uuid, total bigint, done bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select collaborator_id,
         count(*),
         count(*) filter (where status = 'finalizada')
  from task_instances
  where (p_start is null or task_date >= p_start)
  group by collaborator_id;
$$;

-- Contagens por empresa no período, no banco. Alimenta os cards de empresa do
-- painel do consultor e do "Minhas empresas" do colaborador. p_collaborator
-- restringe ao próprio (colaborador). company_name vem por join sob a MESMA RLS
-- (o embed que a tela usava também passava por companies_select). Definições
-- espelham as telas: pending = nem finalizada nem cancelada; overdue = pendente
-- com prazo vencido; due_soon = pendente com prazo nas próximas 24h.
create or replace function company_task_counts(
  p_start date, p_collaborator uuid default null
) returns table (
  company_id uuid, company_name text, total bigint, done bigint,
  pending bigint, overdue bigint, due_soon bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select ti.company_id,
         c.name,
         count(*),
         count(*) filter (where ti.status = 'finalizada'),
         count(*) filter (where ti.status not in ('finalizada', 'cancelada')),
         count(*) filter (
           where ti.status not in ('finalizada', 'cancelada') and ti.due_at < now()
         ),
         count(*) filter (
           where ti.status not in ('finalizada', 'cancelada')
             and ti.due_at >= now()
             and ti.due_at < now() + interval '24 hours'
         )
    from task_instances ti
    left join companies c on c.id = ti.company_id
   where (p_start is null or ti.task_date >= p_start)
     and (p_collaborator is null or ti.collaborator_id = p_collaborator)
   group by ti.company_id, c.name;
$$;

grant execute on function task_status_counts(date, uuid) to authenticated;
grant execute on function collaborator_task_counts(date) to authenticated;
grant execute on function company_task_counts(date, uuid) to authenticated;
