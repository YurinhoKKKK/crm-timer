-- =====================================================================
-- GRÁFICO "TEMPO POR EMPRESA" — faixa opcional das TAREFAS PADRÃO (diárias)
-- =====================================================================
-- O gráfico por categoria (0088) só mostra tarefas identificáveis por categoria
-- (+ listagem). As tarefas padrão (kind='diaria', sem categoria) ficam de fora.
-- Esta migration acrescenta uma agregação SEPARADA do tempo dessas diárias, para
-- o gráfico exibi-las como UMA faixa própria quando o usuário liga o botão (por
-- padrão OCULTAS — o caminho atual não muda: quem só chama as RPCs antigas vê
-- exatamente o de antes).
--
-- BUCKET '__diaria__' = kind='diaria' AND category IS NULL AND template_type <>
-- 'listagem'. Assim NÃO há dupla contagem: uma diária que porventura tenha
-- categoria continua na sua categoria; a listagem continua em "Listagem".
-- Mesma fonte/regra das demais (time_entries por started_at BRT, entry_seconds).
-- =====================================================================

-- Tempo das diárias (bucket padrão) por empresa — some quando o botão liga.
create or replace function public.time_by_company_standard(
  p_start date,
  p_collaborator uuid default null
)
returns table(company_id uuid, seconds bigint)
language sql
stable
set search_path to 'public'
as $function$
  select t.company_id,
         coalesce(sum(entry_seconds(te.seconds, te.started_at, te.ended_at)), 0)::bigint
    from time_entries te
    join task_instances t  on t.id = te.task_id
    join task_templates tt on tt.id = t.template_id
   where (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
     and tt.kind = 'diaria'
     and tt.category is null
     and tt.template_type <> 'listagem'
   group by t.company_id;
$function$;

-- Detalhamento por tarefa — agora entende o bucket '__diaria__' (as diárias sem
-- categoria) além das categorias normais. Sem mudança de assinatura: o caminho
-- das categorias existentes segue idêntico.
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
     and (p_start is null or te.started_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
     and (p_collaborator is null or te.collaborator_id = p_collaborator)
     and (
       case when p_category = '__diaria__'
            then tt.kind = 'diaria' and tt.category is null and tt.template_type <> 'listagem'
            else coalesce(tt.category::text, 'listagem') = p_category
                 and (tt.category is not null or tt.template_type = 'listagem')
       end
     )
   group by te.task_id;
$function$;

grant execute on function public.time_by_company_standard(date, uuid) to authenticated;
