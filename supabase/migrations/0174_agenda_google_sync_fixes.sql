-- =====================================================================
-- 0174 — Travas na sincronização Google→CRM + falhas da agenda (revisão da 0172)
-- =====================================================================
-- Fecha as decisões A1–A11, B13 (notificação), B17 e C18 da revisão:
--  A1  cancelamento automático SÓ com status=cancelled explícito; 404/410 marca
--      google_missing_at e vai para a fila (motivo 'nao_encontrada'), nunca apaga.
--  A2  reunião PASSADA nunca é apagada pela sincronização: só google_removed_at.
--      Exclusão automática apenas de reunião FUTURA sem timer (no núcleo).
--  A3  meetings.google_email = conta dona do evento; conta atual diferente →
--      não toca (nem update nem cancel), fila 'conta_diferente' + aviso.
--      Backfill: e-mail atual só onde dá para provar que não mudou.
--  A4  >3 cancelamentos no mesmo sync → nenhum automático; todos para a fila.
--  A5  google_sync_status <> 'sincronizado' → não aplica update; fila
--      'edicao_pendente' (a edição do CRM ainda não foi ao Google).
--  A6  item a item com exception; validações iguais no enqueue e no apply;
--      horário inválido/dia inteiro → fila com motivo.
--  A7  meet_link sozinho não é alteração (fora do diff).
--  A8  aplicar linha da fila recusa se a reunião mudou no CRM após detected_at.
--  A9  eventos de origem Google: details.agendaDe + "via Google Agenda de NOME".
--  A10 google_removed_at: fora do conflito e do portal do cliente.
--  A11 evento recorrente → fila 'recorrente', nunca aplica.
--  B13 notificação persistente p/ criador com reunião FUTURA fora do Google.
--  B17 schedule_conflicts não conta 2x (sistema + cópia importada do convidado).
--  C18 reuniao_cancelada guarda título/data/empresa/convidados/tipo/sala/link
--      (toda exclusão, CRM ou Google) — permite recriar.
-- Convenção (0173): toda função recriada → revoke public, anon, authenticated
-- + grant explícito só a quem precisa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------
alter table meetings
  add column if not exists google_email      text,         -- conta Google dona do evento (A3)
  add column if not exists google_missing_at timestamptz;  -- 404/410 na varredura (A1); limpa quando reaparece

comment on column meetings.google_email is
  'E-mail da conta Google em que o evento foi criado/atualizado pela última vez (A3/0174). Conta conectada diferente → sync não toca na reunião. null = incerto (conta trocada antes do rastreio) → também não toca.';
comment on column meetings.google_missing_at is
  'Evento não encontrado no Google (404/410) na última varredura (A1/0174). NÃO é cancelamento: só marca e enfileira para revisão. Limpo quando o evento volta a ser lido.';

alter table meeting_google_reconciliation add column if not exists motivo text;
comment on column meeting_google_reconciliation.motivo is
  'Por que a linha está na fila (0174): cancelado_google, nao_encontrada, conta_diferente, edicao_pendente, sem_horario, horario_invalido, recorrente, muitos_cancelamentos, erro_interno. null = divergência comum de update.';

alter table meeting_google_reconciliation
  drop constraint meeting_google_reconciliation_proposed_action_check;
alter table meeting_google_reconciliation
  add constraint meeting_google_reconciliation_proposed_action_check
  check (proposed_action in ('update', 'cancel_delete', 'cancel_keep', 'revisar'));

-- Tipos novos de notificação (B13 e A3) no CHECK de notifications.type.
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type = any (array['mencionado','resposta_recebida','tarefa_atribuida',
    'tarefa_recorrente_atribuida','listagem_ajuste_solicitado','reuniao_convite',
    'reuniao_cancelada','empresa_onboarding','empresa_renovacao','digisac_sync_auth',
    'digisac_sync_error','digisac_sync_stalled','reuniao_em_andamento',
    'reuniao_encerrada_auto','reuniao_fora_google','agenda_conta_diferente']));

-- ---------------------------------------------------------------------
-- 2. Backfill de google_email (A3). Critério verificável (a auditoria não guarda
--    o e-mail, então "trocou de conta" é inferido pelas LACUNAS):
--    · revogado→conectado em ≤ 1h = RECONSENTIMENTO da mesma conta (casos reais:
--      Nathan 20s, Camilli 1min, Filipe Peres 9min, Alex 1min) → e-mail atual;
--    · lacuna > 1h = TROCA POSSÍVEL (casos reais: Mateus 8 dias, Yuri ~2 dias) →
--      e-mail atual só nas 'sincronizado' cuja última conversa com o Google
--      (updated_at, bumpado pelo setSync pós-PATCH) é POSTERIOR à última conexão
--      — um PATCH ok depois de reconectar prova que o evento vive na conta atual
--      (conta errada daria 404→falhou). As demais ficam NULL = conta incerta →
--      o sync não toca (vai para a fila como conta_diferente).
-- ---------------------------------------------------------------------
with ev as (
  select user_id, action, created_at,
         lead(action)     over w as next_action,
         lead(created_at) over w as next_at
  from google_calendar_audit
  window w as (partition by user_id order by created_at)
), troca_possivel as (
  select user_id from ev
  where action = 'revogado' and next_action = 'conectado'
    and next_at - created_at > interval '1 hour'
  group by user_id
), last_conn as (
  select user_id, max(created_at) as t
  from google_calendar_audit where action = 'conectado' group by user_id
)
update meetings m
   set google_email = ga.google_email
  from google_accounts ga
 where m.created_by = ga.user_id
   and m.google_event_id is not null
   and m.google_email is null
   and (
     m.created_by not in (select user_id from troca_possivel)
     or (m.google_sync_status = 'sincronizado'
         and m.updated_at >= (select t from last_conn lc where lc.user_id = m.created_by))
   );

-- ---------------------------------------------------------------------
-- 3. Gatilho de histórico — DELETE vira BEFORE (convidados ainda existem) e os
--    details do reuniao_cancelada ficam completos (C18): título, data, empresa,
--    convidados, tipo, sala e link. A9: origem google ganha agendaDe (GUC
--    app.meeting_event_agenda_de = uuid do dono) e "via Google Agenda de NOME".
-- ---------------------------------------------------------------------
create or replace function meetings_event_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin  text := coalesce(current_setting('app.meeting_event_origin', true), 'crm');
  v_agenda  uuid := nullif(current_setting('app.meeting_event_agenda_de', true), '')::uuid;
  -- Admin aplicando um item da FILA (meeting_reconcile_apply seta o GUC): vira o
  -- ATOR do evento e entra no resumo. Aplicação automática não seta, fica null.
  v_applied uuid := nullif(current_setting('app.meeting_event_applied_by', true), '')::uuid;
  v_agenda_nome text;
  v_applied_nome text;
  v_actor   uuid := case when v_origin = 'google' then v_applied else auth.uid() end;
  v_via     text := '';
  v_when    text;
  v_changes jsonb;
  v_guests  jsonb;
  v_old_co  text;
  v_new_co  text;
begin
  if v_origin = 'google' then
    if v_agenda is not null then
      select full_name into v_agenda_nome from profiles where id = v_agenda;
    end if;
    if v_applied is not null then
      select full_name into v_applied_nome from profiles where id = v_applied;
    end if;
    v_via := case when v_agenda is not null
                  then ' (via Google Agenda de ' || coalesce(v_agenda_nome, '?')
                  else ' (via Google' end
          || case when v_applied is not null
                  then ', aplicada por ' || coalesce(v_applied_nome, '?') || ' na reconciliação'
                  else '' end
          || ')';
  end if;

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
    -- Empresa em EXCLUSÃO (cascade): não há histórico para gravar — sem o guard,
    -- o INSERT em company_events violaria a FK e abortaria a exclusão da empresa.
    if not exists (select 1 from companies c where c.id = new.company_id) then
      return null;
    end if;

    -- TROCA DE EMPRESA: evento nas DUAS pontas (saiu de / entrou em).
    if new.company_id is distinct from old.company_id then
      select c.name into v_new_co from companies c where c.id = new.company_id;
      select c.name into v_old_co from companies c where c.id = old.company_id;
      v_changes := jsonb_build_object('meetingId', new.id, 'origem', v_origin,
                                      'empresaDe', old.company_id, 'empresaPara', new.company_id,
                                      'empresaDeNome', v_old_co, 'empresaParaNome', v_new_co)
                   || case when v_agenda is null then '{}'::jsonb
                           else jsonb_build_object('agendaDe', v_agenda) end;
      if old.company_id is not null
         and exists (select 1 from companies c where c.id = old.company_id) then
        insert into company_events (company_id, event_type, summary, details, actor_id)
        values (old.company_id, 'reuniao_editada',
                'Reunião “' || coalesce(new.title, '(sem título)') || '” movida para a empresa '
                  || coalesce(v_new_co, '?') || v_via,
                v_changes, v_actor);
      end if;
      insert into company_events (company_id, event_type, summary, details, actor_id)
      values (new.company_id, 'reuniao_editada',
              'Reunião “' || coalesce(new.title, '(sem título)') || '” recebida da empresa '
                || coalesce(v_old_co, '?') || v_via,
              v_changes, v_actor);
    end if;

    -- Só título/início/fim viram evento (setSync/responses não geram ruído).
    if new.title     is not distinct from old.title
       and new.starts_at is not distinct from old.starts_at
       and new.ends_at   is not distinct from old.ends_at then
      return null;
    end if;
    v_changes := jsonb_build_object('meetingId', new.id, 'origem', v_origin);
    if v_agenda is not null then
      v_changes := v_changes || jsonb_build_object('agendaDe', v_agenda);
    end if;
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
            'Reunião “' || coalesce(new.title, '(sem título)') || '” alterada' || v_via,
            v_changes, v_actor);
    return null;

  else -- BEFORE DELETE: meeting_participants ainda existem (cascade ainda não rodou)
    if old.company_id is null then return old; end if;
    -- Empresa em EXCLUSÃO (cascade companies→meetings): o histórico da empresa
    -- está indo junto — gravar evento violaria a FK e ABORTARIA a exclusão (23503).
    if not exists (select 1 from companies c where c.id = old.company_id) then
      return old;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name)
                              order by pr.full_name), '[]'::jsonb)
      into v_guests
      from meeting_participants mp
      join profiles pr on pr.id = mp.user_id
     where mp.meeting_id = old.id;
    v_when := to_char(old.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'reuniao_cancelada',
            'Reunião “' || coalesce(old.title, '(sem título)') || '” (' || v_when || ') cancelada' || v_via,
            jsonb_build_object('meetingId', old.id, 'titulo', old.title,
                               'startsAt', old.starts_at, 'endsAt', old.ends_at,
                               'meetingType', old.meeting_type, 'room', old.room,
                               'meetLink', old.meet_link, 'convidados', v_guests,
                               'origem', v_origin)
              || case when v_agenda is null then '{}'::jsonb
                      else jsonb_build_object('agendaDe', v_agenda) end,
            v_actor);
    return old;
  end if;
end;
$$;

drop trigger if exists trg_meetings_event on meetings;
create trigger trg_meetings_event
  after insert or update on meetings
  for each row execute function meetings_event_trg();

drop trigger if exists trg_meetings_event_delete on meetings;
create trigger trg_meetings_event_delete
  before delete on meetings
  for each row execute function meetings_event_trg();

-- ---------------------------------------------------------------------
-- 4. Núcleo de aplicação — travas A2 (passada nunca apaga) + A9 (agendaDe).
--    Exclui SÓ reunião FUTURA sem timer; qualquer outro cancel marca
--    google_removed_at. Valida horários (A6) como última defesa.
-- ---------------------------------------------------------------------
create or replace function _apply_meeting_google_change(
  p_meeting uuid, p_title text, p_starts timestamptz, p_ends timestamptz,
  p_meet text, p_cancel boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m record;
  v_has_timer boolean;
  v_future boolean;
  v_reason text;
  -- Admin aplicando pela fila (GUC de meeting_reconcile_apply): nomeia o autor
  -- também no evento do cancel_keep, que não passa pelo gatilho de histórico.
  v_applied uuid := nullif(current_setting('app.meeting_event_applied_by', true), '')::uuid;
  v_applied_nome text;
begin
  select id, company_id, title, starts_at, created_by into v_m
    from meetings where id = p_meeting;
  if not found then return; end if;

  if v_applied is not null then
    select full_name into v_applied_nome from profiles where id = v_applied;
  end if;

  perform set_config('app.meeting_event_origin', 'google', true);
  perform set_config('app.meeting_event_agenda_de', v_m.created_by::text, true);

  if p_cancel then
    select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_has_timer;
    v_future := v_m.starts_at > now();
    if v_future and not v_has_timer then
      delete from meetings where id = p_meeting;  -- BEFORE DELETE grava o evento rico
    else
      v_reason := case when v_has_timer then 'por ter horas registradas'
                       else 'por já ter acontecido' end;
      update meetings set google_removed_at = now(), updated_at = now()
       where id = p_meeting and google_removed_at is null;
      if found then
        perform log_company_event(
          v_m.company_id, 'reuniao_cancelada',
          'Reunião “' || coalesce(v_m.title, '(sem título)')
            || '” foi removida no Google; mantida no CRM ' || v_reason
            || case when v_applied is not null
                    then ', aplicada por ' || coalesce(v_applied_nome, '?') || ' na reconciliação'
                    else '' end,
          jsonb_build_object('meetingId', p_meeting, 'origem', 'google',
                             'mantida', true, 'agendaDe', v_m.created_by),
          v_applied, 'google_removed', p_meeting::text);
      end if;
    end if;
  else
    if p_starts is null or p_ends is null or p_ends <= p_starts then
      raise exception 'horário inválido para aplicar (início/fim nulos ou fim <= início)';
    end if;
    update meetings
       set title = coalesce(nullif(btrim(p_title), ''), '(sem título)'),
           starts_at = p_starts, ends_at = p_ends,
           meet_link = coalesce(p_meet, meet_link),
           google_missing_at = null,
           updated_at = now()
     where id = p_meeting;
  end if;
end;
$$;
revoke all on function _apply_meeting_google_change(uuid, text, timestamptz, timestamptz, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Helper interno da fila — upsert de uma linha com motivo e ação proposta.
--    'revisar' = nada a aplicar (conta/recorrente/horário/edição pendente);
--    cancel-ish decide keep×delete por timer E por passado (A2).
-- ---------------------------------------------------------------------
-- Cast seguro p/ os timestamps vindos da op: op corrompida não pode impedir o
-- registro do erro_interno (o token incremental já avançou; perder = sumir).
create or replace function _mgr_safe_ts(p text)
returns timestamptz
language plpgsql immutable as $$
begin
  return nullif(p, '')::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function _mgr_safe_ts(text) from public, anon, authenticated;

create or replace function _mgr_upsert(p_meeting uuid, p_owner uuid, p_op jsonb, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m record; v_timer boolean; v_action text; v_cancelish boolean;
begin
  select id, company_id, title, starts_at, ends_at, meet_link into v_m
    from meetings where id = p_meeting;
  if not found then return; end if;

  v_cancelish := coalesce((p_op->>'cancel')::boolean, false)
                 or p_motivo in ('nao_encontrada', 'cancelado_google', 'muitos_cancelamentos');
  select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_timer;

  v_action := case
    when p_motivo in ('conta_diferente','recorrente','sem_horario','horario_invalido',
                      'edicao_pendente','erro_interno') then 'revisar'
    when v_cancelish and (v_timer or v_m.starts_at <= now()) then 'cancel_keep'
    when v_cancelish then 'cancel_delete'
    else 'update'
  end;

  insert into meeting_google_reconciliation
    (meeting_id, owner_id, company_id, proposed_action, motivo,
     crm_title, crm_starts_at, crm_ends_at, crm_meet_link,
     google_title, google_starts_at, google_ends_at, google_meet_link,
     google_event_id, google_updated_at, has_timer, status, detected_at)
  values
    (p_meeting, p_owner, v_m.company_id, v_action, p_motivo,
     v_m.title, v_m.starts_at, v_m.ends_at, v_m.meet_link,
     p_op->>'title', _mgr_safe_ts(p_op->>'startsAt'),
     _mgr_safe_ts(p_op->>'endsAt'), nullif(p_op->>'meetLink',''),
     p_op->>'eventId', _mgr_safe_ts(p_op->>'updated'), v_timer, 'pending', now())
  on conflict (meeting_id) do update set
     owner_id = excluded.owner_id, company_id = excluded.company_id,
     proposed_action = excluded.proposed_action, motivo = excluded.motivo,
     crm_title = excluded.crm_title, crm_starts_at = excluded.crm_starts_at,
     crm_ends_at = excluded.crm_ends_at, crm_meet_link = excluded.crm_meet_link,
     google_title = excluded.google_title, google_starts_at = excluded.google_starts_at,
     google_ends_at = excluded.google_ends_at, google_meet_link = excluded.google_meet_link,
     google_event_id = excluded.google_event_id, google_updated_at = excluded.google_updated_at,
     has_timer = excluded.has_timer, status = 'pending', detected_at = now(),
     resolved_at = null, resolved_by = null
  -- Dispensada fica dispensada enquanto o Google não mudar (auditoria, achado 13):
  -- a mesma divergência re-detectada em toda varredura não reenche a fila.
  where meeting_google_reconciliation.status <> 'dismissed'
     or meeting_google_reconciliation.google_updated_at
        is distinct from excluded.google_updated_at;

  if p_motivo = 'nao_encontrada' then
    update meetings set google_missing_at = coalesce(google_missing_at, now())
     where id = p_meeting;
  end if;
end;
$$;
revoke all on function _mgr_upsert(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Aviso de conta diferente (A3): notifica o dono e os admins, com dedupe por
--    reunião (uma vez; não spamma a cada sync).
-- ---------------------------------------------------------------------
create or replace function _mgr_notify_conta_diferente(p_meeting uuid, p_owner uuid, p_title text)
returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if exists (select 1 from notifications
              where type = 'agenda_conta_diferente' and source_id = p_meeting) then
    return;
  end if;
  perform push_notification(p_owner, 'agenda_conta_diferente',
    'Reunião “' || coalesce(p_title,'(sem título)') || '” pertence a outra conta Google',
    'A conta conectada hoje é diferente da que criou o evento. A sincronização não toca nesta reunião; reveja na fila de reconciliação.',
    null, 'meeting', p_meeting, null);
  for r in select id from profiles where role = 'admin' loop
    perform push_notification(r.id, 'agenda_conta_diferente',
      'Reunião “' || coalesce(p_title,'(sem título)') || '” com conta Google divergente',
      'Conta conectada difere da dona do evento. Ver fila em Reconciliação da Agenda.',
      null, 'meeting', p_meeting, null);
  end loop;
end;
$$;
revoke all on function _mgr_notify_conta_diferente(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. AUTO-SYNC forward — reescrito com as travas:
--    item a item com exception (A6); conta (A3); edição pendente (A5); guarda
--    updated + diff sem meet_link (A7); teto de 3 cancelamentos (A4); cancel
--    automático só vem de status=cancelled explícito (A1 — quem monta as ops é
--    o servidor a partir do sync incremental; 404 nunca entra aqui, só na fila).
--    USUÁRIO NÃO RECONCILIADO (auditoria): nunca descarta — o sync incremental
--    consome o syncToken, então toda op vai para a FILA DE REVISÃO com as mesmas
--    validações do enqueue, SEM carimbar last_reconcile_scan_at (isto não é a
--    varredura GET-dirigida de 6h; carimbar aqui a afogaria).
-- ---------------------------------------------------------------------
create or replace function meetings_apply_google_sync(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_email   text;
  v_trusted boolean;
  v_op      jsonb;
  v_cur     record;
  v_upd     timestamptz;
  v_motivo  text;
  v_applied int := 0;
  v_queued  int := 0;
  v_cancels jsonb[] := '{}';
  c         jsonb;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;

  select auto_apply_from is not null into v_trusted
    from google_calendar_import_state where user_id = v_user;
  select google_email into v_email from google_accounts where user_id = v_user;

  -- -------- NÃO RECONCILIADO: tudo para a fila, nada aplicado, nada descartado.
  if not coalesce(v_trusted, false) then
    for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
      begin
        select m.id, m.title, m.starts_at, m.ends_at, m.updated_at,
               m.google_email, m.google_sync_status
          into v_cur
          from meetings m
         where m.created_by = v_user
           and m.google_event_id = (v_op->>'eventId')
           and m.google_removed_at is null
         limit 1;
        if not found then continue; end if;

        v_motivo := nullif(v_op->>'motivo', '');
        if v_motivo is distinct from 'conta_diferente'
           and (v_cur.google_email is null or v_email is null
                or v_cur.google_email <> v_email) then
          v_motivo := 'conta_diferente';
        end if;
        if v_motivo = 'conta_diferente' then
          perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
          perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
          v_queued := v_queued + 1;
          continue;
        end if;
        if v_motivo is not null then
          perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
          v_queued := v_queued + 1;
          continue;
        end if;
        if coalesce((v_op->>'cancel')::boolean, false) then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'cancelado_google');
          v_queued := v_queued + 1;
          continue;
        end if;
        if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario');
          v_queued := v_queued + 1; continue;
        end if;
        if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido');
          v_queued := v_queued + 1; continue;
        end if;
        if v_cur.google_sync_status <> 'sincronizado' then
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente');
          v_queued := v_queued + 1; continue;
        end if;
        -- Guarda anti-desfazer + sem divergência real (diff sem meet_link, A7).
        v_upd := nullif(v_op->>'updated', '')::timestamptz;
        if v_upd is not null and v_upd <= v_cur.updated_at then continue; end if;
        if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
             = coalesce(v_cur.title, '')
           and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
           and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
          continue;
        end if;
        perform _mgr_upsert(v_cur.id, v_user, v_op, null);
        v_queued := v_queued + 1;
      exception when others then
        -- O token incremental já avançou: erro aqui NÃO pode sumir com a
        -- mudança. Registra na fila como erro_interno; só então engole.
        begin
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'erro_interno');
          v_queued := v_queued + 1;
        exception when others then null;
        end;
      end;
    end loop;
    return jsonb_build_object('applied', 0, 'queued', v_queued, 'trusted', false);
  end if;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin  -- A6: um item inválido não derruba o lote
      select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.updated_at,
             m.google_email, m.google_sync_status
        into v_cur
        from meetings m
       where m.created_by = v_user
         and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null
       limit 1;
      if not found then continue; end if;

      -- Motivo vindo do servidor (dia inteiro, recorrente etc.): direto p/ fila.
      v_motivo := nullif(v_op->>'motivo', '');
      if v_motivo is not null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        v_queued := v_queued + 1;
        continue;
      end if;

      -- A3: conta diferente (ou incerta = null) → não toca; fila + aviso.
      if v_cur.google_email is null or v_email is null
         or v_cur.google_email <> v_email then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'conta_diferente');
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_queued := v_queued + 1;
        continue;
      end if;

      if coalesce((v_op->>'cancel')::boolean, false) then
        v_cancels := v_cancels || v_op;  -- teto A4 decide depois do laço
        continue;
      end if;

      -- A5: edição do CRM ainda não enviada ao Google → não sobrescrever.
      if v_cur.google_sync_status <> 'sincronizado' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente');
        v_queued := v_queued + 1;
        continue;
      end if;

      -- A6: validação de horários.
      if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario');
        v_queued := v_queued + 1; continue;
      end if;
      if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido');
        v_queued := v_queued + 1; continue;
      end if;

      -- Guarda anti-desfazer + diff SEM meet_link (A7).
      v_upd := nullif(v_op->>'updated', '')::timestamptz;
      if v_upd is not null and v_upd <= v_cur.updated_at then continue; end if;
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
           = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
        continue;
      end if;

      perform _apply_meeting_google_change(
        v_cur.id, v_op->>'title',
        (v_op->>'startsAt')::timestamptz, (v_op->>'endsAt')::timestamptz,
        nullif(v_op->>'meetLink', ''), false);
      v_applied := v_applied + 1;
    exception when others then
      begin
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'erro_interno');
        v_queued := v_queued + 1;
      exception when others then null;
      end;
    end;
  end loop;

  -- A4: teto de cancelamentos por execução.
  if coalesce(array_length(v_cancels, 1), 0) > 3 then
    foreach c in array v_cancels loop
      begin
        select m.id into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (c->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _mgr_upsert(v_cur.id, v_user, c, 'muitos_cancelamentos');
          v_queued := v_queued + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  else
    foreach c in array v_cancels loop
      begin
        select m.id into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (c->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _apply_meeting_google_change(v_cur.id, null, null, null, null, true);
          v_applied := v_applied + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  end if;

  return jsonb_build_object('applied', v_applied, 'queued', v_queued, 'trusted', true);
end;
$$;
revoke execute on function meetings_apply_google_sync(jsonb) from public, anon, authenticated;
grant  execute on function meetings_apply_google_sync(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. ENFILEIRAR (varredura do dono) — reescrito: motivos, conta, item a item,
--    validações iguais às do apply. Op válida sem motivo limpa google_missing_at
--    (o evento voltou a ser lido).
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_enqueue(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_op    jsonb;
  v_cur   record;
  v_motivo text;
  v_count int := 0;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select google_email into v_email from google_accounts where user_id = v_user;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin
      select m.id, m.title, m.starts_at, m.ends_at, m.google_email, m.google_sync_status
        into v_cur
        from meetings m
       where m.created_by = v_user
         and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null
       limit 1;
      if not found then continue; end if;

      v_motivo := nullif(v_op->>'motivo', '');

      -- A3 também aqui: conta diferente/incerta sobrepõe qualquer outro motivo
      -- (o estado lido do Google pode nem ser do evento certo).
      if v_motivo is distinct from 'conta_diferente'
         and (v_cur.google_email is null or v_email is null
              or v_cur.google_email <> v_email) then
        v_motivo := 'conta_diferente';
      end if;
      if v_motivo = 'conta_diferente' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        perform _mgr_notify_conta_diferente(v_cur.id, v_user, v_cur.title);
        v_count := v_count + 1;
        continue;
      end if;

      if v_motivo is not null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        v_count := v_count + 1;
        continue;
      end if;

      -- Op normal (evento lido com sucesso): o evento existe → limpa o missing.
      update meetings set google_missing_at = null
       where id = v_cur.id and google_missing_at is not null;

      -- Validações (iguais ao apply).
      if coalesce((v_op->>'cancel')::boolean, false) then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'cancelado_google');
        v_count := v_count + 1;
        continue;
      end if;
      if nullif(v_op->>'startsAt','') is null or nullif(v_op->>'endsAt','') is null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'sem_horario');
        v_count := v_count + 1; continue;
      end if;
      if (v_op->>'endsAt')::timestamptz <= (v_op->>'startsAt')::timestamptz then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'horario_invalido');
        v_count := v_count + 1; continue;
      end if;
      if v_cur.google_sync_status <> 'sincronizado' then
        perform _mgr_upsert(v_cur.id, v_user, v_op, 'edicao_pendente');
        v_count := v_count + 1; continue;
      end if;

      -- Sem divergência real (diff sem meet_link, A7): não enfileira.
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
           = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
        continue;
      end if;

      perform _mgr_upsert(v_cur.id, v_user, v_op, null);
      v_count := v_count + 1;
    exception when others then
      null;  -- item inválido não derruba o lote (A6)
    end;
  end loop;

  update google_calendar_import_state set last_reconcile_scan_at = now() where user_id = v_user;
  return jsonb_build_object('enqueued', v_count);
end;
$$;
revoke execute on function meeting_reconcile_enqueue(jsonb) from public, anon, authenticated;
grant  execute on function meeting_reconcile_enqueue(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Fila: aplicar com trava de staleness (A8) + recusa de 'revisar' + mesmas
--    validações; listar com motivo.
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_apply(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row meeting_google_reconciliation%rowtype; v_m record;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem aplicar a reconciliação.' using errcode = '42501';
  end if;
  select * into v_row from meeting_google_reconciliation where id = p_id;
  if not found then raise exception 'Linha de reconciliação não encontrada.'; end if;
  if v_row.status <> 'pending' then raise exception 'Esta linha já foi resolvida.'; end if;
  if v_row.meeting_id is null then raise exception 'A reunião desta linha não existe mais.'; end if;
  if v_row.proposed_action = 'revisar' then
    raise exception 'Esta linha é só para revisão (%): não há mudança automática a aplicar. Use Dispensar após resolver.', coalesce(v_row.motivo, 'revisar');
  end if;

  select updated_at into v_m from meetings where id = v_row.meeting_id;
  if v_m.updated_at > v_row.detected_at then
    raise exception 'A reunião mudou no CRM depois desta detecção. Rode uma nova varredura antes de aplicar.';
  end if;

  -- Quem está aplicando pela fila vira o AUTOR do evento de histórico (o gatilho
  -- e o cancel_keep leem este GUC e compõem "aplicada por NOME na reconciliação").
  perform set_config('app.meeting_event_applied_by', auth.uid()::text, true);

  if v_row.proposed_action = 'update' then
    if v_row.google_starts_at is null or v_row.google_ends_at is null
       or v_row.google_ends_at <= v_row.google_starts_at then
      raise exception 'Horário do Google inválido nesta linha: não é aplicável.';
    end if;
    perform _apply_meeting_google_change(v_row.meeting_id, v_row.google_title,
      v_row.google_starts_at, v_row.google_ends_at, v_row.google_meet_link, false);
  else  -- cancel_delete / cancel_keep (o núcleo re-decide por timer e passado)
    perform _apply_meeting_google_change(v_row.meeting_id, null, null, null, null, true);
  end if;

  update meeting_google_reconciliation
     set status = 'applied', resolved_at = now(), resolved_by = auth.uid()
   where id = p_id;
end;
$$;
revoke execute on function meeting_reconcile_apply(uuid) from public, anon, authenticated;
grant  execute on function meeting_reconcile_apply(uuid) to authenticated;

drop function if exists meeting_reconcile_list();
create or replace function meeting_reconcile_list()
returns table (
  id uuid, meeting_id uuid, owner_id uuid, owner_name text,
  company_id uuid, company_name text, proposed_action text, motivo text,
  crm_title text, crm_starts_at timestamptz, crm_ends_at timestamptz, crm_meet_link text,
  google_title text, google_starts_at timestamptz, google_ends_at timestamptz, google_meet_link text,
  has_timer boolean, google_updated_at timestamptz, detected_at timestamptz,
  owner_auto_apply_from timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.meeting_id, r.owner_id, p.full_name,
         r.company_id, c.name, r.proposed_action, r.motivo,
         r.crm_title, r.crm_starts_at, r.crm_ends_at, r.crm_meet_link,
         r.google_title, r.google_starts_at, r.google_ends_at, r.google_meet_link,
         r.has_timer, r.google_updated_at, r.detected_at,
         s.auto_apply_from
    from meeting_google_reconciliation r
    left join profiles p on p.id = r.owner_id
    left join companies c on c.id = r.company_id
    left join google_calendar_import_state s on s.user_id = r.owner_id
   where (select is_admin()) and r.status = 'pending'
     and r.meeting_id is not null  -- órfã (reunião excluída por fora) sai da fila
   order by p.full_name nulls last, r.google_starts_at nulls last;
$$;
revoke execute on function meeting_reconcile_list() from public, anon, authenticated;
grant  execute on function meeting_reconcile_list() to authenticated;

-- ---------------------------------------------------------------------
-- 10. Conflitos (A10 + B17): reunião removida no Google fica fora; a CÓPIA
--     IMPORTADA de uma reunião do CRM (mesmo google_event_id na agenda de um
--     convidado) não conta de novo — o lado 'sistema' já cobre criador e
--     convidados. Mesma assinatura e retorno (shape em produção).
-- ---------------------------------------------------------------------
create or replace function schedule_conflicts(
  p_starts    timestamptz,
  p_ends      timestamptz,
  p_user_ids  uuid[],
  p_exclude   uuid default null
)
returns table (
  source               text,
  ref_id               uuid,
  title                text,
  starts_at            timestamptz,
  ends_at              timestamptz,
  company_name         text,
  conflicting_user_ids uuid[]
)
language sql stable security definer set search_path = public
as $$
  select 'sistema'::text, m.id, m.title, m.starts_at, m.ends_at, c.name,
         array_agg(distinct cu.uid order by cu.uid)
  from meetings m
  join companies c on c.id = m.company_id
  join lateral (
    select u.uid
    from unnest(p_user_ids) as u(uid)
    where m.created_by = u.uid
       or exists (select 1 from meeting_participants mp
                   where mp.meeting_id = m.id and mp.user_id = u.uid)
  ) cu on true
  where m.starts_at < p_ends
    and m.ends_at   > p_starts
    and m.google_removed_at is null
    and (p_exclude is null or m.id <> p_exclude)
  group by m.id, m.title, m.starts_at, m.ends_at, c.name

  union all

  select 'google'::text, e.id,
         case when e.is_private and e.user_id <> auth.uid() then null else e.title end,
         e.starts_at, e.ends_at, null::text,
         array[e.user_id]
  from imported_google_events e
  where e.user_id = any(p_user_ids)
    and e.starts_at < p_ends
    and e.ends_at   > p_starts
    and not exists (select 1 from meetings mm
                     where mm.google_event_id = e.google_event_id)

  order by 4;
$$;
revoke execute on function schedule_conflicts(timestamptz, timestamptz, uuid[], uuid) from public, anon, authenticated;
grant  execute on function schedule_conflicts(timestamptz, timestamptz, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Portal do cliente (A10): reunião removida no Google não aparece.
--     Mesma assinatura e retorno. Interna (chamada só por client_portal_meetings,
--     DEFINER) → sem grant a ninguém.
-- ---------------------------------------------------------------------
create or replace function client_portal_meetings_payload(p_company uuid, p_limit integer, p_offset integer)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_limit      integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset     integer := greatest(coalesce(p_offset, 0), 0);
  v_past_total bigint;
  v_upcoming   jsonb;
  v_past       jsonb;
begin
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title', up.title, 'starts_at', up.starts_at, 'ends_at', up.ends_at,
             'type', up.meeting_type,
             'meet_link', case when up.meeting_type = 'meet' then up.meet_link else null end
           ) order by up.starts_at asc, up.id
         ), '[]'::jsonb)
    into v_upcoming
    from (
      select m.id, m.title, m.starts_at, m.ends_at, m.meeting_type, m.meet_link
        from meetings m
       where m.company_id = p_company
         and not m.client_hidden
         and m.google_removed_at is null
         and m.ends_at > now()
       order by m.starts_at asc, m.id
       limit 100
    ) up;

  select count(*) into v_past_total
    from meetings m
   where m.company_id = p_company
     and not m.client_hidden
     and m.google_removed_at is null
     and m.ends_at <= now();

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title', pg.title, 'starts_at', pg.starts_at, 'ends_at', pg.ends_at,
             'type', pg.meeting_type
           ) order by pg.starts_at desc, pg.id
         ), '[]'::jsonb)
    into v_past
    from (
      select m.id, m.title, m.starts_at, m.ends_at, m.meeting_type
        from meetings m
       where m.company_id = p_company
         and not m.client_hidden
         and m.google_removed_at is null
         and m.ends_at <= now()
       order by m.starts_at desc, m.id
       limit v_limit offset v_offset
    ) pg;

  return jsonb_build_object(
    'upcoming', v_upcoming,
    'past', jsonb_build_object('total', v_past_total, 'items', v_past)
  );
end;
$$;
revoke all on function client_portal_meetings_payload(uuid, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. B13 — notificação persistente: reunião FUTURA que ficou fora do Google
--     (nao_conectado/falhou) notifica o criador, uma vez por reunião.
-- ---------------------------------------------------------------------
create or replace function meetings_sync_pending_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.google_sync_status in ('nao_conectado', 'falhou')
     and new.starts_at > now()
     and (tg_op = 'INSERT' or old.google_sync_status is distinct from new.google_sync_status)
     and not exists (select 1 from notifications
                      where type = 'reuniao_fora_google' and source_id = new.id) then
    perform push_notification(new.created_by, 'reuniao_fora_google',
      'Reunião “' || coalesce(new.title,'(sem título)') || '” não está na sua agenda Google',
      'Ela foi salva no CRM, mas não chegou ao Google ('
        || case when new.google_sync_status = 'nao_conectado'
                then 'conta não conectada' else 'falha na sincronização' end
        || '). Abra a Agenda e use “Enviar para o Google”.',
      new.company_id, 'meeting', new.id, null);
  end if;
  return null;
end;
$$;
revoke all on function meetings_sync_pending_notify() from public, anon, authenticated;

drop trigger if exists trg_meetings_sync_pending_notify on meetings;
create trigger trg_meetings_sync_pending_notify
  after insert or update of google_sync_status on meetings
  for each row execute function meetings_sync_pending_notify();

-- Backfill: notifica os casos já existentes (ex.: Ana Cristina, 3 futuras).
do $$
declare r record;
begin
  for r in
    select m.id, m.title, m.company_id, m.created_by, m.google_sync_status
      from meetings m
     where m.google_sync_status in ('nao_conectado', 'falhou')
       and m.starts_at > now()
       and not exists (select 1 from notifications n
                        where n.type = 'reuniao_fora_google' and n.source_id = m.id)
  loop
    perform push_notification(r.created_by, 'reuniao_fora_google',
      'Reunião “' || coalesce(r.title,'(sem título)') || '” não está na sua agenda Google',
      'Ela foi salva no CRM, mas não chegou ao Google ('
        || case when r.google_sync_status = 'nao_conectado'
                then 'conta não conectada' else 'falha na sincronização' end
        || '). Abra a Agenda e use “Enviar para o Google”.',
      r.company_id, 'meeting', r.id, null);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. B15 — status de sincronização da agenda por pessoa (para "atualizada há X"
--     na Agenda e o alerta de agenda velha no aviso de conflito). Só metadados
--     (quando sincronizou), nada da agenda em si.
-- ---------------------------------------------------------------------
create or replace function agenda_sync_status()
returns table (user_id uuid, google_connected boolean, last_synced_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id,
         exists (select 1 from google_accounts ga where ga.user_id = p.id),
         (select s.last_synced_at from google_calendar_import_state s where s.user_id = p.id)
    from profiles p
   where auth.uid() is not null
     and p.role in ('admin', 'consultor', 'colaborador', 'gestor_trafego', 'desenvolvedor');
$$;
revoke execute on function agenda_sync_status() from public, anon, authenticated;
grant  execute on function agenda_sync_status() to authenticated;

-- ---------------------------------------------------------------------
-- 14. google_email NÃO depende do front (A3, reforço). O setSync novo manda o
--     e-mail junto com o event_id, mas o código ANTIGO em produção grava o
--     event_id sem ele — e a reunião nasceria "conta incerta" para sempre.
--     O banco garante: ao GRAVAR/TROCAR google_event_id com google_email nulo,
--     preenche com a conta Google atual do criador (é com o token DELA que o
--     evento acabou de ser criado no Google). Um UPDATE que NÃO mexe no
--     event_id nunca preenche — reunião antiga com e-mail NULL (= conta
--     incerta, decisão do backfill da seção 2) continua intocada.
-- ---------------------------------------------------------------------
create or replace function meetings_fill_google_email()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.google_event_id is not null
     and new.google_email is null
     and (tg_op = 'INSERT' or new.google_event_id is distinct from old.google_event_id) then
    select ga.google_email into new.google_email
      from google_accounts ga
     where ga.user_id = new.created_by;
  end if;
  return new;
end;
$$;
revoke all on function meetings_fill_google_email() from public, anon, authenticated;

drop trigger if exists trg_meetings_fill_google_email on meetings;
create trigger trg_meetings_fill_google_email
  before insert or update of google_event_id on meetings
  for each row execute function meetings_fill_google_email();

-- Backfill: reuniões criadas DEPOIS da 0174 entrar em produção (19/11/2026
-- 19:37:28 UTC) pelo código antigo — o evento foi criado agora, com o token da
-- conta atual do criador, então a mesma regra do gatilho vale. As anteriores ao
-- corte ficam como o backfill da seção 2 decidiu (NULL = conta incerta).
update meetings m
   set google_email = ga.google_email
  from google_accounts ga
 where ga.user_id = m.created_by
   and m.google_event_id is not null
   and m.google_email is null
   and m.created_at >= '2026-11-19 19:37:28+00';

-- ---------------------------------------------------------------------
-- 15. Convite sem duplicata: o updateMeeting antigo (em produção) apagava e
--     REINSERIA todos os participantes a cada edição, e o trigger de convite
--     (AFTER INSERT em meeting_participants, 0077) notificava todo mundo de
--     novo (casos reais 19/11: Pagnan 2x para 6 pessoas, Elos 2x, SOS 2x).
--     O diff do front (B16) corta a reinserção na origem; o banco garante:
--     o mesmo (reunião, convidado) nunca é notificado duas vezes.
-- ---------------------------------------------------------------------
create or replace function notify_meeting_invite()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_company uuid; v_title text; v_created_by uuid; v_actor uuid;
begin
  select company_id, title, created_by
  into v_company, v_title, v_created_by
  from meetings where id = new.meeting_id;

  -- O organizador não é notificado do próprio convite (mesmo quando um terceiro
  -- o adiciona como participante).
  if new.user_id = v_created_by then return null; end if;

  -- Dedupe (0174): já foi convidado desta reunião alguma vez → não re-notifica
  -- (cobre reinserção por edição E remove-e-readiciona de propósito).
  if exists (select 1 from notifications
              where type = 'reuniao_convite'
                and source_id = new.meeting_id
                and user_id = new.user_id) then
    return null;
  end if;

  v_actor := coalesce(auth.uid(), v_created_by);
  perform push_notification(
    new.user_id, 'reuniao_convite', 'Convidou você para uma reunião', v_title,
    v_company, 'meeting', new.meeting_id, v_actor
  );
  return null;
end;
$$;
revoke all on function notify_meeting_invite() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 16. Excluir EMPRESA com reuniões voltou a funcionar (auditoria, achado 1).
--     Dois gatilhos escreviam/mexiam em linhas da empresa NO MEIO do cascade
--     companies→meetings/meeting_timers e abortavam a exclusão com 23503:
--     · meetings_event_trg (acima, seção 3): ganhou o guard de empresa
--       inexistente nos branches UPDATE e DELETE;
--     · meetings_timer_detach (0147): o UPDATE em meeting_timers durante o
--       cascade faz o Postgres revalidar a FK de company_id contra a empresa já
--       apagada. Pula timers de empresa em exclusão — o próprio cascade os
--       remove em seguida. (Exclusão NORMAL de reunião segue preservando as
--       horas: meeting_id SET NULL + origin_deleted_at.)
-- ---------------------------------------------------------------------
create or replace function meetings_timer_detach()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update meeting_timers set origin_deleted_at = now()
   where meeting_id = old.id and origin_deleted_at is null
     and exists (select 1 from companies c where c.id = meeting_timers.company_id);
  return old;
end; $$;

-- ---------------------------------------------------------------------
-- 17. Concluir a reconciliação exige sincronização RECENTE do dono (≤ 30 min).
--     Com a seção 7, TODO sync (incremental ou completo) joga as divergências de
--     reuniões do CRM na fila enquanto o dono não é reconciliado — então "sync
--     recente" = fila completa até poucos minutos atrás, e o auto-sync assume
--     sem buraco. A varredura GET não dá para rodar daqui: o token Google é do
--     DONO (sem service_role); quem conclui a própria reconciliação dispara
--     sync + varredura forçada no front antes de chamar esta função.
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_finalize(p_owner uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sync timestamptz;
  v_name text;
  v_pending int;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores podem concluir a reconciliação.' using errcode = '42501';
  end if;
  select full_name into v_name from profiles where id = p_owner;

  -- Pendências na fila travam a conclusão: ligar o auto-sync com itens abertos
  -- deixaria divergências conhecidas sem decisão do admin.
  select count(*)::int into v_pending
    from meeting_google_reconciliation r
   where r.owner_id = p_owner and r.status = 'pending' and r.meeting_id is not null;
  if v_pending > 0 then
    raise exception 'Ainda há % na fila para %. Aplique ou dispense cada uma antes de ligar o auto-sync.',
      case when v_pending = 1 then '1 divergência pendente' else v_pending || ' divergências pendentes' end,
      coalesce(v_name, '?');
  end if;

  select last_synced_at into v_sync from google_calendar_import_state where user_id = p_owner;
  if v_sync is null or v_sync < now() - interval '30 minutes' then
    raise exception 'A agenda Google de % precisa de uma sincronização recente antes de concluir (última: %; limite: 30 minutos). Peça para a pessoa abrir a Agenda do CRM, pois cada sincronização joga as divergências pendentes na fila, e conclua logo em seguida.',
      coalesce(v_name, '?'),
      coalesce(to_char(v_sync at time zone 'America/Sao_Paulo', 'DD/MM às HH24:MI'), 'nunca sincronizada');
  end if;
  insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
  values (p_owner, now(), now())
  on conflict (user_id) do update set auto_apply_from = now(), updated_at = now();
end;
$$;
revoke execute on function meeting_reconcile_finalize(uuid) from public, anon, authenticated;
grant  execute on function meeting_reconcile_finalize(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 18. Roster da reconciliação (admin): TODOS os usuários com Google conectado,
--     com último sync, estado do auto-sync e pendências na fila. Alimenta a
--     seção "Usuários com Google conectado" do painel, onde o Concluir mora —
--     antes o botão só existia dentro do bloco de divergências, então usuário
--     sem pendência nunca podia ser concluído.
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_owners()
returns table (
  user_id uuid, full_name text, google_email text,
  last_synced_at timestamptz, auto_apply_from timestamptz, pending integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, ga.google_email,
         s.last_synced_at, s.auto_apply_from,
         (select count(*)::int
            from meeting_google_reconciliation r
           where r.owner_id = p.id and r.status = 'pending'
             and r.meeting_id is not null)
    from google_accounts ga
    join profiles p on p.id = ga.user_id
    left join google_calendar_import_state s on s.user_id = ga.user_id
   where (select is_admin())
   order by p.full_name;
$$;
revoke execute on function meeting_reconcile_owners() from public, anon, authenticated;
grant  execute on function meeting_reconcile_owners() to authenticated;
