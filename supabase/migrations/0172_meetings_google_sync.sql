-- =====================================================================
-- 0172 — O Google volta a mandar nas reuniões do CRM
-- =====================================================================
-- Hoje a importação (0050) DESCARTA os eventos que casam com reuniões do CRM
-- (systemIds), então mover/renomear/apagar no Google nunca volta para a meeting.
-- Esta migração dá o caminho de volta, em DOIS regimes que convivem:
--
--   (A) AUTO-SYNC para frente (decisões 1–5): no mesmo ciclo do import, quando o
--       evento do Google casa com meetings.google_event_id do dono, a meeting é
--       ATUALIZADA (título/início/fim/meet) ou CANCELADA — sem prévia. Só para
--       usuários JÁ RECONCILIADOS (auto_apply_from setado).
--
--   (B) RECONCILIAÇÃO ÚNICA dos casos antigos (decisão 6): enquanto o dono não foi
--       reconciliado (auto_apply_from nulo), a sincronização só ENFILEIRA as
--       divergências numa fila de revisão; o admin confere CRM×Google e aplica
--       (aplicar é só banco — não precisa do token de ninguém). Ao "Concluir", o
--       admin seta auto_apply_from do dono e o regime (A) assume dali pra frente.
--
-- RESTRIÇÃO que molda tudo: só a sessão do PRÓPRIO dono lê a agenda dele
-- (google_get_account por auth.uid(), sem service_role). Por isso o ENFILEIRAR e a
-- leitura do Google rodam na sessão do dono; o APLICAR (banco puro) é do admin.
--
-- GUARDA anti-"desfazer edição do CRM" (decisão 1): só aplica update quando
-- google.updated > meetings.updated_at E algum valor difere. Como setSync bumpa
-- updated_at DEPOIS do PATCH, a edição feita no CRM nunca é revertida.
--
-- CANCELAMENTO (decisão 2): o evento já saiu do Google (o Google já avisou os
-- convidados na hora) — não há novo e-mail. Com timer registrado: MANTÉM e marca
-- google_removed_at (não perder horas). Sem timer: EXCLUI pelo caminho normal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------
alter table meetings
  add column if not exists google_removed_at timestamptz;  -- mantida apesar de removida no Google

comment on column meetings.google_removed_at is
  'Quando o evento foi removido no Google mas a reunião foi MANTIDA no CRM (tinha timer: não perder horas). null = não removida. Badge "removida no Google".';

alter table google_calendar_import_state
  add column if not exists auto_apply_from     timestamptz,  -- null = não reconciliado (só enfileira); setado = auto-aplica
  add column if not exists last_reconcile_scan_at timestamptz; -- anti-revarredura a cada page load

comment on column google_calendar_import_state.auto_apply_from is
  'null = usuário ainda não reconciliado: a sincronização só ENFILEIRA divergências. setado = usuário confiável: auto-aplica mudanças do Google no ciclo do import.';

-- Fila de revisão compartilhada (decisão 6). Uma linha PENDENTE por reunião.
create table meeting_google_reconciliation (
  id               uuid primary key default gen_random_uuid(),
  meeting_id       uuid references meetings(id) on delete set null,  -- set null: a linha SOBREVIVE ao cancel_delete (auditoria)
  owner_id         uuid not null references profiles(id) on delete cascade,
  company_id       uuid references companies(id) on delete set null,
  proposed_action  text not null check (proposed_action in ('update', 'cancel_delete', 'cancel_keep')),
  -- de (CRM) — snapshot no momento da detecção
  crm_title        text,
  crm_starts_at    timestamptz,
  crm_ends_at      timestamptz,
  crm_meet_link    text,
  -- para (Google) — o que o Google diz agora
  google_title     text,
  google_starts_at timestamptz,
  google_ends_at   timestamptz,
  google_meet_link text,
  google_event_id  text,
  google_updated_at timestamptz,
  has_timer        boolean not null default false,
  status           text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references profiles(id),
  unique (meeting_id)  -- re-varredura faz upsert; nulos (pós-aplicação) não colidem
);

create index idx_mgr_status on meeting_google_reconciliation(status, owner_id);

alter table meeting_google_reconciliation enable row level security;

-- Leitura: o dono vê as suas; o admin vê todas (o painel). Escrita só por função.
create policy mgr_select on meeting_google_reconciliation for select
  using (owner_id = auth.uid() or (select is_admin()));

comment on table meeting_google_reconciliation is
  'Fila de revisão da reconciliação Google→CRM (decisão 6). Enfileirada na sessão do dono; aplicada pelo admin (banco puro). meeting_id vira null quando o cancel_delete remove a reunião — a linha fica como auditoria.';

-- ---------------------------------------------------------------------
-- 2. Catálogos de histórico — + 'reuniao_editada' (decisão 3).
--    Recria label/category incluindo o tipo novo (espelha 0168). Visibilidade
--    não muda: reuniao_editada cai no 'reach' (default), que é o correto.
-- ---------------------------------------------------------------------
create or replace function activity_type_label(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    -- Atividade / Tarefas
    when 'atividade'                      then 'Atividade'
    when 'tarefa_criada'                  then 'Tarefa criada'
    when 'tarefa_editada'                 then 'Tarefa editada'
    when 'tarefa_concluida'               then 'Tarefa concluída'
    when 'tarefa_excluida'                then 'Tarefa excluída'
    when 'tarefa_cancelada'               then 'Tarefa cancelada'
    when 'tarefa_reaberta'                then 'Tarefa reaberta'
    when 'tarefa_expirada'                then 'Tarefa expirada'
    when 'ocorrencia_prazo_alterado'      then 'Prazo da ocorrência alterado'
    when 'ocorrencia_excluida'            then 'Ocorrência excluída'
    when 'tarefa_recorrente_criada'       then 'Tarefa recorrente criada'
    when 'tarefa_recorrente_editada'      then 'Tarefa recorrente editada'
    when 'tarefa_recorrente_desativada'   then 'Tarefa recorrente desativada'
    when 'tarefa_desativada_catalogo'     then 'Tarefa desativada pelo catálogo'
    when 'tarefa_reativada_catalogo'      then 'Tarefa reativada pelo catálogo'
    when 'tarefas_pausadas_grupo'         then 'Tarefas pausadas (grupo)'
    when 'tarefas_retomadas_grupo'        then 'Tarefas retomadas (grupo)'
    -- Responsáveis
    when 'tarefa_responsavel_alterada'    then 'Responsável alterado'
    when 'tarefas_repassadas'             then 'Tarefas repassadas'
    when 'consultor_adicionado'           then 'Consultor adicionado'
    when 'consultor_removido'             then 'Consultor removido'
    when 'consultor_trocado'              then 'Consultor trocado'
    when 'colaborador_adicionado'         then 'Colaborador adicionado'
    when 'colaborador_removido'           then 'Colaborador removido'
    when 'colaborador_trocado'            then 'Colaborador trocado'
    -- Tempo
    when 'tempo_ajustado'                 then 'Tempo ajustado'
    -- Contrato / Faturamento
    when 'informacoes_alteradas'          then 'Informações alteradas'
    when 'faturamento_lancado'            then 'Faturamento lançado'
    when 'faturamento_corrigido'          then 'Faturamento corrigido'
    when 'valor_contrato_alterado'        then 'Valor do contrato alterado'
    when 'canais_alterados'               then 'Canais alterados'
    when 'pausa_iniciada'                 then 'Pausa iniciada'
    when 'pausa_encerrada'                then 'Pausa encerrada'
    -- Sucesso do Cliente
    when 'cs_alterado'                    then 'Sucesso do Cliente alterado'
    when 'churn_registrado'               then 'Churn registrado'
    when 'churn_editado'                  then 'Churn editado'
    -- Contato
    when 'empresa_renomeada'              then 'Empresa renomeada'
    when 'contato_digisac_alterado'       then 'Contato do Digisac alterado'
    when 'grupo_whatsapp_alterado'        then 'Grupo de WhatsApp alterado'
    -- Empresa / Cadastro
    when 'grupo_alterado'                 then 'Grupo alterado'
    when 'etiqueta_alterada'              then 'Etiqueta alterada'
    when 'empresa_criada_crm'             then 'Empresa criada (CRM)'
    -- Tráfego / Desenvolvimento
    when 'trafego_alterado'               then 'Tráfego alterado'
    when 'dev_alterado'                   then 'Desenvolvimento alterado'
    -- Reuniões
    when 'reuniao_criada'                 then 'Reunião criada'
    when 'reuniao_editada'                then 'Reunião alterada'
    when 'reuniao_cancelada'              then 'Reunião cancelada'
    when 'timer_reuniao_editado'          then 'Timer de reunião editado'
    -- Portal
    when 'acesso_cliente_criado'          then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_link_girado'     then 'Link do cliente girado'
    when 'acesso_cliente_revogado'        then 'Acesso do cliente revogado'
    -- Anotações
    when 'anotacao_editada'               then 'Anotação editada'
    when 'anotacao_excluida'              then 'Anotação excluída'
    -- Listagens
    when 'listagem_validada'              then 'Listagem validada'
    else p_type
  end;
$$;
grant execute on function activity_type_label(text) to authenticated, anon;

create or replace function activity_type_category(p_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_type
    when 'atividade'                      then 'tempo'
    when 'tempo_ajustado'                 then 'tempo'
    when 'tarefa_criada'                  then 'tarefas'
    when 'tarefa_editada'                 then 'tarefas'
    when 'tarefa_concluida'               then 'tarefas'
    when 'tarefa_excluida'                then 'tarefas'
    when 'tarefa_cancelada'               then 'tarefas'
    when 'tarefa_reaberta'                then 'tarefas'
    when 'tarefa_expirada'                then 'tarefas'
    when 'ocorrencia_prazo_alterado'      then 'tarefas'
    when 'ocorrencia_excluida'            then 'tarefas'
    when 'tarefa_recorrente_criada'       then 'tarefas'
    when 'tarefa_recorrente_editada'      then 'tarefas'
    when 'tarefa_recorrente_desativada'   then 'tarefas'
    when 'tarefa_desativada_catalogo'     then 'tarefas'
    when 'tarefa_reativada_catalogo'      then 'tarefas'
    when 'tarefas_pausadas_grupo'         then 'tarefas'
    when 'tarefas_retomadas_grupo'        then 'tarefas'
    when 'tarefa_responsavel_alterada'    then 'responsaveis'
    when 'tarefas_repassadas'             then 'responsaveis'
    when 'consultor_adicionado'           then 'responsaveis'
    when 'consultor_removido'             then 'responsaveis'
    when 'consultor_trocado'              then 'responsaveis'
    when 'colaborador_adicionado'         then 'responsaveis'
    when 'colaborador_removido'           then 'responsaveis'
    when 'colaborador_trocado'            then 'responsaveis'
    when 'informacoes_alteradas'          then 'contrato'
    when 'faturamento_lancado'            then 'contrato'
    when 'faturamento_corrigido'          then 'contrato'
    when 'valor_contrato_alterado'        then 'contrato'
    when 'canais_alterados'               then 'contrato'
    when 'pausa_iniciada'                 then 'contrato'
    when 'pausa_encerrada'                then 'contrato'
    when 'cs_alterado'                    then 'cs'
    when 'churn_registrado'               then 'cs'
    when 'churn_editado'                  then 'cs'
    when 'empresa_renomeada'              then 'contato'
    when 'contato_digisac_alterado'       then 'contato'
    when 'grupo_whatsapp_alterado'        then 'contato'
    when 'grupo_alterado'                 then 'empresa'
    when 'etiqueta_alterada'              then 'empresa'
    when 'empresa_criada_crm'             then 'empresa'
    when 'trafego_alterado'               then 'trafego'
    when 'dev_alterado'                   then 'desenvolvimento'
    when 'reuniao_criada'                 then 'reunioes'
    when 'reuniao_editada'                then 'reunioes'
    when 'reuniao_cancelada'              then 'reunioes'
    when 'timer_reuniao_editado'          then 'reunioes'
    when 'acesso_cliente_criado'          then 'portal'
    when 'acesso_cliente_senha_redefinida' then 'portal'
    when 'acesso_cliente_link_girado'     then 'portal'
    when 'acesso_cliente_revogado'        then 'portal'
    when 'anotacao_editada'               then 'anotacoes'
    when 'anotacao_excluida'              then 'anotacoes'
    when 'listagem_validada'              then 'tarefas'
    else 'empresa'
  end;
$$;
grant execute on function activity_type_category(text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Gatilho de histórico das reuniões — agora INSERT/UPDATE/DELETE, com origem.
--    (recria o de 0072; a origem vem do GUC app.meeting_event_origin, setado
--     pela função de aplicação Google; default 'crm' = edição humana no CRM.)
-- ---------------------------------------------------------------------
create or replace function meetings_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin  text := coalesce(current_setting('app.meeting_event_origin', true), 'crm');
  v_actor   uuid := case when v_origin = 'google' then null else auth.uid() end;
  v_when    text;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    if new.company_id is null then return null; end if;
    v_when := to_char(new.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'reuniao_criada',
            'Reunião “' || coalesce(new.title, '(sem título)') || '” criada para ' || v_when,
            jsonb_build_object('meetingId', new.id, 'startsAt', new.starts_at,
                               'meetingType', new.meeting_type, 'room', new.room,
                               'origem', v_origin),
            auth.uid());
    return null;

  elsif tg_op = 'UPDATE' then
    if new.company_id is null then return null; end if;
    -- Só título/início/fim viram evento. setSync/refreshResponses mexem em outros
    -- campos (status, meet, room_response) e NÃO devem gerar "reunião alterada".
    if new.title     is not distinct from old.title
       and new.starts_at is not distinct from old.starts_at
       and new.ends_at   is not distinct from old.ends_at then
      return null;
    end if;
    v_changes := jsonb_build_object('meetingId', new.id, 'origem', v_origin);
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('tituloDe', old.title, 'tituloPara', new.title);
    end if;
    if new.starts_at is distinct from old.starts_at then
      v_changes := v_changes || jsonb_build_object('inicioDe', old.starts_at, 'inicioPara', new.starts_at);
    end if;
    if new.ends_at is distinct from old.ends_at then
      v_changes := v_changes || jsonb_build_object('fimDe', old.ends_at, 'fimPara', new.ends_at);
    end if;
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'reuniao_editada',
            'Reunião “' || coalesce(new.title, '(sem título)') || '” alterada'
              || case when v_origin = 'google' then ' (via Google)' else '' end,
            v_changes, v_actor);
    return null;

  else -- DELETE
    if old.company_id is null then return null; end if;
    v_when := to_char(old.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'reuniao_cancelada',
            'Reunião “' || coalesce(old.title, '(sem título)') || '” (' || v_when || ') cancelada'
              || case when v_origin = 'google' then ' (removida no Google)' else '' end,
            jsonb_build_object('meetingId', old.id, 'startsAt', old.starts_at,
                               'meetingType', old.meeting_type, 'room', old.room,
                               'origem', v_origin),
            v_actor);
    return null;
  end if;
end;
$$;

drop trigger if exists trg_meetings_event on meetings;
create trigger trg_meetings_event
  after insert or update or delete on meetings
  for each row execute function meetings_event_trg();

-- ---------------------------------------------------------------------
-- 4. Núcleo: aplica UMA mudança do Google numa meeting (banco puro, sem Google).
--    Seta a origem 'google' no GUC (o gatilho acima lê e credita "Sistema").
--    Cancelar: com timer MANTÉM+marca; sem timer EXCLUI (dispara os triggers).
-- ---------------------------------------------------------------------
create or replace function _apply_meeting_google_change(
  p_meeting uuid,
  p_title   text,
  p_starts  timestamptz,
  p_ends    timestamptz,
  p_meet    text,
  p_cancel  boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_has_timer boolean;
  v_company   uuid;
  v_title     text;
begin
  perform set_config('app.meeting_event_origin', 'google', true);  -- transação-local

  if p_cancel then
    select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting)
      into v_has_timer;
    if v_has_timer then
      select company_id, title into v_company, v_title from meetings where id = p_meeting;
      update meetings
         set google_removed_at = now(), updated_at = now()
       where id = p_meeting and google_removed_at is null;
      -- Histórico: mantida por ter horas. Idempotente por (source, source_id).
      perform log_company_event(
        v_company, 'reuniao_cancelada',
        'Reunião “' || coalesce(v_title, '(sem título)')
          || '” foi removida no Google; mantida no CRM por ter horas registradas',
        jsonb_build_object('meetingId', p_meeting, 'origem', 'google', 'mantida', true),
        null, 'google_removed', p_meeting::text);
    else
      delete from meetings where id = p_meeting;  -- gatilho cancela c/ origem 'google'
    end if;
  else
    update meetings
       set title     = p_title,
           starts_at = p_starts,
           ends_at   = p_ends,
           meet_link = coalesce(p_meet, meet_link),
           updated_at = now()
     where id = p_meeting;
  end if;
end;
$$;
-- Helper INTERNO: não tem checagem de autorização própria (muda/exclui qualquer
-- meeting). Só pode ser chamado de dentro das funções DEFINER (que rodam como
-- dono). O Supabase concede EXECUTE a `authenticated` por padrão em funções novas
-- no schema public — por isso revogamos de authenticated TAMBÉM, senão um usuário
-- logado poderia chamá-lo direto via PostgREST e alterar reunião alheia.
revoke all on function _apply_meeting_google_change(uuid, text, timestamptz, timestamptz, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. AUTO-SYNC (dono, forward) — só para quem já foi reconciliado. Recebe as ops
--    montadas no servidor a partir do ciclo do import. Guarda por operação.
-- ---------------------------------------------------------------------
create or replace function meetings_apply_google_sync(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_trusted boolean;
  v_op      jsonb;
  v_cur     record;
  v_upd     timestamptz;
  v_applied int := 0;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;

  select auto_apply_from is not null into v_trusted
    from google_calendar_import_state where user_id = v_user;
  if not coalesce(v_trusted, false) then
    return jsonb_build_object('applied', 0, 'trusted', false);
  end if;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.updated_at
      into v_cur
      from meetings m
     where m.created_by = v_user
       and m.google_event_id = (v_op->>'eventId')
       and m.google_removed_at is null
     limit 1;
    if not found then continue; end if;

    if coalesce((v_op->>'cancel')::boolean, false) then
      perform _apply_meeting_google_change(v_cur.id, null, null, null, null, true);
      v_applied := v_applied + 1;
      continue;
    end if;

    -- Guarda: Google precisa ser MAIS NOVO que a meeting (não desfazer edição do
    -- CRM que ainda está sincronizando) E algum valor precisa diferir.
    v_upd := nullif(v_op->>'updated', '')::timestamptz;
    if v_upd is not null and v_upd <= v_cur.updated_at then continue; end if;
    if coalesce(v_op->>'title', '') = coalesce(v_cur.title, '')
       and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
       and (v_op->>'endsAt')::timestamptz = v_cur.ends_at
       and coalesce(v_op->>'meetLink', '') = coalesce(v_cur.meet_link, '') then
      continue;  -- nada mudou de fato
    end if;

    perform _apply_meeting_google_change(
      v_cur.id, v_op->>'title',
      (v_op->>'startsAt')::timestamptz, (v_op->>'endsAt')::timestamptz,
      nullif(v_op->>'meetLink', ''), false);
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'trusted', true);
end;
$$;
revoke execute on function meetings_apply_google_sync(jsonb) from public, anon;
grant  execute on function meetings_apply_google_sync(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. ENFILEIRAR (dono, backlog) — monta/atualiza as linhas pendentes a partir das
--    ops lidas da agenda REAL do dono (distingue movida de apagada). Não aplica.
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_enqueue(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_op     jsonb;
  v_cur    record;
  v_timer  boolean;
  v_action text;
  v_cancel boolean;
  v_gtitle text;
  v_gstart timestamptz;
  v_gend   timestamptz;
  v_gmeet  text;
  v_count  int := 0;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    select m.id, m.company_id, m.title, m.starts_at, m.ends_at, m.meet_link
      into v_cur
      from meetings m
     where m.created_by = v_user
       and m.google_event_id = (v_op->>'eventId')
       and m.google_removed_at is null
     limit 1;
    if not found then continue; end if;

    v_cancel := coalesce((v_op->>'cancel')::boolean, false);
    v_gtitle := v_op->>'title';
    v_gstart := nullif(v_op->>'startsAt', '')::timestamptz;
    v_gend   := nullif(v_op->>'endsAt', '')::timestamptz;
    v_gmeet  := nullif(v_op->>'meetLink', '');

    -- Update sem divergência real: não enfileira.
    if not v_cancel
       and coalesce(v_gtitle, '') = coalesce(v_cur.title, '')
       and v_gstart = v_cur.starts_at
       and v_gend   = v_cur.ends_at then
      continue;
    end if;

    select exists (select 1 from meeting_timers t where t.meeting_id = v_cur.id) into v_timer;
    v_action := case
      when not v_cancel then 'update'
      when v_timer      then 'cancel_keep'
      else 'cancel_delete'
    end;

    insert into meeting_google_reconciliation
      (meeting_id, owner_id, company_id, proposed_action,
       crm_title, crm_starts_at, crm_ends_at, crm_meet_link,
       google_title, google_starts_at, google_ends_at, google_meet_link,
       google_event_id, google_updated_at, has_timer, status, detected_at)
    values
      (v_cur.id, v_user, v_cur.company_id, v_action,
       v_cur.title, v_cur.starts_at, v_cur.ends_at, v_cur.meet_link,
       v_gtitle, v_gstart, v_gend, v_gmeet,
       v_op->>'eventId', nullif(v_op->>'updated', '')::timestamptz, v_timer, 'pending', now())
    on conflict (meeting_id) do update set
       owner_id         = excluded.owner_id,
       company_id       = excluded.company_id,
       proposed_action  = excluded.proposed_action,
       crm_title        = excluded.crm_title,
       crm_starts_at    = excluded.crm_starts_at,
       crm_ends_at      = excluded.crm_ends_at,
       crm_meet_link    = excluded.crm_meet_link,
       google_title     = excluded.google_title,
       google_starts_at = excluded.google_starts_at,
       google_ends_at   = excluded.google_ends_at,
       google_meet_link = excluded.google_meet_link,
       google_event_id  = excluded.google_event_id,
       google_updated_at = excluded.google_updated_at,
       has_timer        = excluded.has_timer,
       status           = 'pending',
       detected_at      = now(),
       resolved_at      = null,
       resolved_by      = null;
    v_count := v_count + 1;
  end loop;

  update google_calendar_import_state set last_reconcile_scan_at = now() where user_id = v_user;
  return jsonb_build_object('enqueued', v_count);
end;
$$;
revoke execute on function meeting_reconcile_enqueue(jsonb) from public, anon;
grant  execute on function meeting_reconcile_enqueue(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. ADMIN — listar / aplicar / dispensar / concluir. Aplicar é banco puro.
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_list()
returns table (
  id uuid, meeting_id uuid, owner_id uuid, owner_name text,
  company_id uuid, company_name text, proposed_action text,
  crm_title text, crm_starts_at timestamptz, crm_ends_at timestamptz, crm_meet_link text,
  google_title text, google_starts_at timestamptz, google_ends_at timestamptz, google_meet_link text,
  has_timer boolean, google_updated_at timestamptz, detected_at timestamptz,
  owner_auto_apply_from timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.meeting_id, r.owner_id, p.full_name,
         r.company_id, c.name, r.proposed_action,
         r.crm_title, r.crm_starts_at, r.crm_ends_at, r.crm_meet_link,
         r.google_title, r.google_starts_at, r.google_ends_at, r.google_meet_link,
         r.has_timer, r.google_updated_at, r.detected_at,
         s.auto_apply_from
    from meeting_google_reconciliation r
    left join profiles p on p.id = r.owner_id
    left join companies c on c.id = r.company_id
    left join google_calendar_import_state s on s.user_id = r.owner_id
   where (select is_admin()) and r.status = 'pending'
   order by p.full_name nulls last, r.google_starts_at nulls last;
$$;
revoke execute on function meeting_reconcile_list() from public, anon;
grant  execute on function meeting_reconcile_list() to authenticated;

create or replace function meeting_reconcile_apply(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row meeting_google_reconciliation%rowtype;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem aplicar a reconciliação.' using errcode = '42501';
  end if;
  select * into v_row from meeting_google_reconciliation where id = p_id;
  if not found then raise exception 'Linha de reconciliação não encontrada.'; end if;
  if v_row.status <> 'pending' then raise exception 'Esta linha já foi resolvida.'; end if;
  if v_row.meeting_id is null then raise exception 'A reunião desta linha não existe mais.'; end if;

  if v_row.proposed_action = 'update' then
    perform _apply_meeting_google_change(v_row.meeting_id, v_row.google_title,
      v_row.google_starts_at, v_row.google_ends_at, v_row.google_meet_link, false);
  else  -- cancel_delete / cancel_keep (a função decide pelo timer)
    perform _apply_meeting_google_change(v_row.meeting_id, null, null, null, null, true);
  end if;

  -- Marca por ID (sobrevive ao SET NULL do meeting_id no cancel_delete).
  update meeting_google_reconciliation
     set status = 'applied', resolved_at = now(), resolved_by = auth.uid()
   where id = p_id;
end;
$$;
revoke execute on function meeting_reconcile_apply(uuid) from public, anon;
grant  execute on function meeting_reconcile_apply(uuid) to authenticated;

create or replace function meeting_reconcile_dismiss(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem dispensar a reconciliação.' using errcode = '42501';
  end if;
  update meeting_google_reconciliation
     set status = 'dismissed', resolved_at = now(), resolved_by = auth.uid()
   where id = p_id and status = 'pending';
end;
$$;
revoke execute on function meeting_reconcile_dismiss(uuid) from public, anon;
grant  execute on function meeting_reconcile_dismiss(uuid) to authenticated;

-- Conclui a reconciliação de um dono: liga o auto-sync dali pra frente.
create or replace function meeting_reconcile_finalize(p_owner uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem concluir a reconciliação.' using errcode = '42501';
  end if;
  insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
  values (p_owner, now(), now())
  on conflict (user_id) do update set auto_apply_from = now(), updated_at = now();
end;
$$;
revoke execute on function meeting_reconcile_finalize(uuid) from public, anon;
grant  execute on function meeting_reconcile_finalize(uuid) to authenticated;
