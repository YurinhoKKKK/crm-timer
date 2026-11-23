-- =====================================================================
-- ROLLBACK da 0173 — restaura os grants de EXECUTE anteriores e a função sem gate.
-- (Reabre a superfície; use só se a 0173 tiver quebrado algum fluxo legítimo.)
-- Estado restaurado = o de antes da 0173 (default do Supabase: anon/authenticated
-- conforme cada função tinha). service_role permanece (sempre teve).
-- =====================================================================

-- Grupo A — regrant conforme o estado anterior (anon só onde existia).
grant execute on function log_company_event(uuid, text, text, jsonb, uuid, text, text)       to authenticated;
grant execute on function push_notification(uuid, text, text, text, uuid, text, uuid, uuid)    to anon, authenticated;
grant execute on function crm_intake_refuse(text, text, text, integer, text, jsonb, text, text, text, jsonb) to anon, authenticated;
grant execute on function traffic_clear_manual_for(uuid[])                                     to anon, authenticated;
grant execute on function generate_template_today(uuid)                                        to anon, authenticated;
grant execute on function meeting_conflicts(timestamptz, timestamptz, uuid[], uuid)            to authenticated;

-- Grupo B — regrant anon/authenticated (service_role já estava concedido).
grant execute on function crm_intake_create(jsonb, text, text)                 to authenticated;
grant execute on function crm_intake_check_duplicate(text, text, text, text)   to anon, authenticated;
grant execute on function digisac_alert(text, text)                            to anon, authenticated;

-- Grupo C — recria generate_template_today_edit SEM o gate (versão 0095).
create or replace function generate_template_today_edit(p_template uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tmpl     record;
  today    date     := (timezone('America/Sao_Paulo', now()))::date;
  dow      smallint := extract(dow from (timezone('America/Sao_Paulo', now()))::date);
  due      timestamptz;
  inserted integer := 0;
begin
  select * into tmpl
    from task_templates
   where id = p_template
     and kind = 'diaria';
  if not found then
    return 'nao_aplica';
  end if;

  if not tmpl.active then
    return 'inativa';
  end if;

  if tmpl.paused_by_group then
    return 'pausada_grupo';
  end if;

  if not (dow = any(tmpl.weekdays)) then
    return 'nao_e_dia';
  end if;

  if tmpl.start_date > today
     or (tmpl.end_date is not null and tmpl.end_date < today) then
    return 'fora_do_periodo';
  end if;

  due := (today::text || ' ' || coalesce(tmpl.due_time, '23:59')::text)::timestamptz;

  insert into task_instances (
    template_id, company_id, collaborator_id, title, description,
    instructions, due_at, task_date
  )
  values (
    tmpl.id, tmpl.company_id, tmpl.collaborator_id, tmpl.title,
    tmpl.description, tmpl.instructions, due, today
  )
  on conflict (template_id, task_date) do nothing;

  get diagnostics inserted = row_count;
  return case when inserted > 0 then 'gerada' else 'ja_existia' end;
end;
$function$;

grant execute on function generate_template_today_edit(uuid) to authenticated;
