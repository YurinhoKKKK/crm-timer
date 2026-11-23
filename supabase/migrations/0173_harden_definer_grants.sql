-- =====================================================================
-- 0173 — Fecha o EXECUTE de funções SECURITY DEFINER sem gate
-- =====================================================================
-- Na 0172 descobrimos que `revoke ... from public, anon` NÃO remove o EXECUTE de
-- `authenticated` (o Supabase concede, por default, EXECUTE a anon, authenticated
-- E service_role em toda função nova no schema public). Varredura das 228 funções
-- SECURITY DEFINER: 32 RPC-like executáveis por authenticated SEM gate no corpo.
-- Classificadas (auditoria completa validada com o dono):
--   · Mutantes internas/só-service_role (forjavam estado): travadas aqui.
--   · 1 chamada autenticada sem gate (generate_template_today_edit): ganha gate.
--   · Leitura inofensiva / helpers de RLS / portal (token): MANTIDAS (justificadas).
--
-- IMPORTANTE (correção da 0172): service_role NÃO ignora grant de EXECUTE (só RLS).
-- As funções chamadas por rota/edge com service_role (crm_intake_* e digisac_alert)
-- recebem GRANT EXPLÍCITO a service_role, para o revoke de authenticated não as
-- derrubar. Os chamadores INTERNOS das demais são todos SECURITY DEFINER (rodam
-- como dono), então o revoke não quebra nenhum fluxo legítimo.
--
-- Prova (grep bare-name em src/**, fora de types.ts/comentários): nenhuma destas
-- é chamada pelo app via supabase.rpc — exceto crm_intake_* (rota service_role) e
-- generate_template_today_edit (autenticado, que ganha gate em vez de revoke).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Grupo A — INTERNAS (só triggers/funcs DEFINER as chamam, como dono).
--   log_company_event ....... 21 funcs DEFINER (gatilhos de histórico)
--   push_notification ........ 11 funcs DEFINER (gatilhos de notificação)
--   crm_intake_refuse ........ crm_intake_create/_check_duplicate (DEFINER)
--   traffic_clear_manual_for . 2 funcs DEFINER (fluxo de tráfego)
--   generate_template_today .. trigger handle_diaria_template_today (DEFINER)
--   meeting_conflicts ........ 0 referências (substituída por schedule_conflicts/0050)
-- Mantemos service_role (inofensivo; chave de servidor) e só tiramos a superfície
-- exposta ao cliente (anon/authenticated).
-- ---------------------------------------------------------------------
revoke execute on function log_company_event(uuid, text, text, jsonb, uuid, text, text)       from public, anon, authenticated;
revoke execute on function push_notification(uuid, text, text, text, uuid, text, uuid, uuid)    from public, anon, authenticated;
revoke execute on function crm_intake_refuse(text, text, text, integer, text, jsonb, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function traffic_clear_manual_for(uuid[])                                     from public, anon, authenticated;
revoke execute on function generate_template_today(uuid)                                        from public, anon, authenticated;
revoke execute on function meeting_conflicts(timestamptz, timestamptz, uuid[], uuid)            from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Grupo B — chamadas por ROTA/EDGE com service_role. Tiram anon/authenticated,
-- GARANTEM service_role explicitamente (a rota /api/crm/** e a edge digisac-sync
-- usam a service_role key; service_role precisa de EXECUTE — não ignora grant).
-- ---------------------------------------------------------------------
revoke execute on function crm_intake_create(jsonb, text, text)                 from public, anon, authenticated;
grant  execute on function crm_intake_create(jsonb, text, text)                 to service_role;

revoke execute on function crm_intake_check_duplicate(text, text, text, text)   from public, anon, authenticated;
grant  execute on function crm_intake_check_duplicate(text, text, text, text)   to service_role;

revoke execute on function digisac_alert(text, text)                            from public, anon, authenticated;
grant  execute on function digisac_alert(text, text)                            to service_role;

-- ---------------------------------------------------------------------
-- Grupo C — generate_template_today_edit: é chamada pelo app AUTENTICADO
-- (admin/actions.ts, após um UPDATE em task_templates já validado pela RLS), mas
-- a RPC em si não tinha gate — qualquer autenticado podia forçar a ocorrência de
-- hoje de QUALQUER diária. Adiciona o gate IDÊNTICO à policy tt_update
-- (is_admin() OR company_id IN my_consultant_companies()). Assinatura e retorno
-- inalterados; mantém authenticated (o app precisa), tira anon.
-- ---------------------------------------------------------------------
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

  -- GATE (0173): mesma autorização do UPDATE da tarefa (policy tt_update). Sem
  -- isso, qualquer autenticado forçaria a ocorrência de hoje de qualquer diária.
  if not ((select is_admin()) or tmpl.company_id in (select my_consultant_companies())) then
    raise exception 'Sem permissão para gerar a ocorrência desta tarefa.' using errcode = '42501';
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

revoke execute on function generate_template_today_edit(uuid) from public, anon;
grant  execute on function generate_template_today_edit(uuid) to authenticated;
