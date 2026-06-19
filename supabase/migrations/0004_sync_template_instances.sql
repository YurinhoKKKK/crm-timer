-- =====================================================================
-- CRM/Timer - Monvatti :: Propagação de edição de template
-- =====================================================================
-- Ao editar um task_template, atualiza as instâncias ainda não iniciadas
-- (status 'a_fazer') para refletir o novo colaborador/empresa/textos/prazo.
-- Instâncias iniciadas, finalizadas ou canceladas ficam intactas.
-- =====================================================================

create or replace function sync_template_instances(p_template uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  tmpl record;
  updated_count integer := 0;
begin
  select * into tmpl from task_templates where id = p_template;
  if not found then
    return 0;
  end if;

  -- Mesma autorização da policy tt_manage: admin ou consultor da empresa.
  if not (is_admin() or tmpl.company_id in (select my_consultant_companies())) then
    raise exception 'not authorized';
  end if;

  update task_instances ti
  set collaborator_id = tmpl.collaborator_id,
      company_id      = tmpl.company_id,
      title           = tmpl.title,
      description     = tmpl.description,
      instructions    = tmpl.instructions,
      task_date       = case when tmpl.kind = 'unica' then tmpl.start_date else ti.task_date end,
      due_at          = (
        (case when tmpl.kind = 'unica' then tmpl.start_date else ti.task_date end)::text
        || ' ' || coalesce(tmpl.due_time, '23:59')::text
      )::timestamptz
  where ti.template_id = p_template
    and ti.status = 'a_fazer';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function sync_template_instances(uuid) to authenticated;
