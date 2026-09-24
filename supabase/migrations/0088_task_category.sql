-- 0088_task_category
--
-- REFORMA DO CADASTRO DE TAREFAS — Parte 1 (banco) + Parte 3 (agregação).
--
-- 1) Enum task_category e coluna task_templates.category (NULA para os modelos
--    existentes). SEM backfill e SEM adivinhar categoria a partir do título
--    antigo: seria dado inventado. O title continua existindo (preserva o
--    histórico das tarefas antigas). Para tarefas novas, o título passa a ser
--    derivado da categoria escolhida (feito na camada de aplicação).
--
-- 2) RPCs de tempo POR CATEGORIA dentro de cada empresa, para o gráfico "Tempo
--    por empresa" do dashboard geral e do dashboard do colaborador. Só entram
--    tarefas identificáveis:
--      - category preenchida (tarefas novas), OU
--      - template_type = 'listagem' (já identificável hoje; tratada como a
--        categoria "Listagem", mesmo sem category).
--    Todo o resto (tarefas antigas de título livre) fica de fora — para sempre,
--    sem corte por data. O tempo é agregado por time_entries pelo dia real do
--    trabalho em horário de Brasília (mesma regra das demais time_by_*), NUNCA
--    por task_date, e NUNCA somado no cliente.

create type task_category as enum (
  'cadastro',
  'precificacao',
  'anuncio',
  'estudo',
  'listagem',
  'integracao',
  'criar_conta'
);

alter table task_templates
  add column category task_category;

comment on column task_templates.category is
  'Categoria da tarefa (padronização do cadastro). NULA para os modelos '
  'anteriores à padronização — não recategorizar; o title preserva o histórico.';

-- Tempo por (empresa, categoria). A categoria é derivada do molde: quando a
-- coluna category está preenchida usa-a; senão (só chega aqui quando é
-- listagem, pelo filtro do WHERE) cai no bucket 'listagem'. Assim a listagem
-- antiga (category nula, template_type='listagem') e a nova (category
-- 'listagem') caem no MESMO bucket. SECURITY INVOKER (padrão): a RLS
-- (te_select/ti_select) é a fronteira; os dashboards que chamam são admin.
create or replace function public.time_by_company_category(
  p_start date,
  p_collaborator uuid default null
)
returns table(company_id uuid, category text, seconds bigint)
language sql
stable
set search_path to 'public'
as $function$
  select t.company_id,
         coalesce(tt.category::text, 'listagem') as category,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t  on t.id = te.task_id
    join task_templates tt on tt.id = t.template_id
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
     and (tt.category is not null or tt.template_type = 'listagem')
   group by t.company_id, coalesce(tt.category::text, 'listagem');
$function$;

-- Tarefas (instâncias) que compõem o tempo de uma (empresa, categoria) no
-- período — mesma fonte/regra da barra, para a soma bater. Devolve task_id +
-- segundos; os metadados (título, status, responsável) são lidos à parte pela
-- action, como já é feito em time_by_task.
create or replace function public.time_by_task_category(
  p_company uuid,
  p_category text,
  p_start date,
  p_collaborator uuid default null
)
returns table(task_id uuid, seconds bigint)
language sql
stable
set search_path to 'public'
as $function$
  select te.task_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t  on t.id = te.task_id
    join task_templates tt on tt.id = t.template_id
   where t.company_id = p_company
     and coalesce(tt.category::text, 'listagem') = p_category
     and (tt.category is not null or tt.template_type = 'listagem')
     and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
   group by te.task_id;
$function$;

grant execute on function public.time_by_company_category(date, uuid) to authenticated;
grant execute on function public.time_by_task_category(uuid, text, date, uuid) to authenticated;
