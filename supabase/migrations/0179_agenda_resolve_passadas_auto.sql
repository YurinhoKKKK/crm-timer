-- =====================================================================
-- 0179 — Agenda: o sistema resolve sozinho reunião passada/ausente/cancelada;
--        a fila de reconciliação vira exceção rara.
-- =====================================================================
-- CONTEXTO (deploy 0172–0178): /admin/reconciliacao-agenda encheu com 19 itens
-- pending, todos cancel_keep, motivo nao_encontrada (13) ou cancelado_google (6),
-- TODOS de reuniões passadas (09/10 a 18/11), de 3 usuários JÁ reconciliados. A
-- varredura (meeting_reconcile_enqueue / enqueueMissingFromFull) enfileirava
-- qualquer op com motivo sem olhar se a reunião já aconteceu. O dono não quer uma
-- fila de revisão: quer que o sistema resolva e que a fila seja exceção.
--
-- REGRAS AUTOMÁTICAS (valem em meeting_reconcile_enqueue E no ramo RECONCILIADO
-- de meetings_apply_google_sync):
--  (a) Reunião PASSADA (ends_at < now()) ausente ou cancelada no Google: NÃO
--      enfileira. Mantém reunião e timer; marca google_missing_at (ausente) ou
--      google_removed_at (cancelada); segue. Nenhuma notificação. Vale TAMBÉM
--      para usuário NÃO reconciliado.
--  (b) Reunião FUTURA cancelada/ausente SEM timer: cancela no CRM pelo mesmo
--      caminho do apply (_apply_meeting_google_change cancel → exclui futura sem
--      timer) e notifica o dono (reunião removida).
--  (c) Reunião FUTURA cancelada/ausente COM timer: mantém a reunião e as horas,
--      marca google_removed_at e notifica o dono (mantida por ter horas).
--  (d) Continuam indo para a fila apenas: conta_diferente, muitos_cancelamentos
--      (mais de 3 reuniões FUTURAS auto-removidas no mesmo lote; passadas não
--      contam), erro_interno, sem_horario, horario_invalido (e, como antes,
--      recorrente e edicao_pendente — divergências reais que exigem decisão
--      humana e NUNCA podem ser descartadas em silêncio).
--  (e) Para 'nao_encontrada' em reunião FUTURA, só agir após o evento faltar em
--      2 varreduras SEGUIDAS: a 1ª marca google_missing_at e não faz mais nada; a
--      2ª (missing já marcado) aplica (b)/(c). Protege contra falha momentânea da
--      API. (Investigação do item 4: os 404 das passadas são ausência REAL do
--      evento na agenda conectada — não falha de leitura nossa —, então o guard
--      de 2 varreduras segue adequado. Ver RELATO no fim do commit.)
--
-- USUÁRIO NÃO RECONCILIADO (ramo não-confiável do apply): só a regra (a) passa a
-- valer; o resto continua indo para a fila como antes.
--
-- LIMPEZA (seção 6): fecha os 19 itens atuais como status 'superado' +
-- resolution_reason 'reuniao_passada' e marca as reuniões conforme (a). Nada é
-- apagado. CONFERÊNCIA ANTES: aborta se o número divergir muito de 19.
--
-- Convenção de grants (0173): helper/gatilho internos → revoke de public, anon,
-- authenticated; RPC chamada pelo front → grant explícito a authenticated.
-- Reversão: supabase/rollback/0179_agenda_resolve_passadas_auto.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema: novo tipo de notificação + comentário do resolution_reason.
-- ---------------------------------------------------------------------
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type = any (array['mencionado','resposta_recebida','tarefa_atribuida',
    'tarefa_recorrente_atribuida','listagem_ajuste_solicitado','reuniao_convite',
    'reuniao_cancelada','empresa_onboarding','empresa_renovacao','digisac_sync_auth',
    'digisac_sync_error','digisac_sync_stalled','reuniao_em_andamento',
    'reuniao_encerrada_auto','reuniao_fora_google','agenda_conta_diferente',
    'agenda_evento_apagado']));

comment on column meeting_google_reconciliation.resolution_reason is
  'Por que a linha SAIU da fila por encerramento automático: aplicado_automaticamente (auto-sync aplicou sozinho), reuniao_excluida (reunião apagada) ou reuniao_passada (0179: reunião passada ausente/cancelada no Google, resolvida sem fila). null quando resolvida pelo admin (applied/dismissed) ou ainda pendente. A coluna motivo (0174) guarda por que ENTROU.';

-- ---------------------------------------------------------------------
-- 2. (a) Resolve uma reunião PASSADA ausente/cancelada: marca a reunião e fecha
--    qualquer pendência já existente daquela reunião como superado/reuniao_passada.
--    Mantém reunião e timer; sem histórico, sem notificação (é silencioso de
--    propósito). coalesce preserva a primeira marca.
--    Escolha do campo:
--      · nao_encontrada → google_missing_at (mantém a reunião 100% visível).
--      · cancelado_google COM timer → google_missing_at. google_removed_at tira a
--        reunião do portal do cliente (A10/0174), e reunião com horas registradas
--        ACONTECEU: tem que continuar no histórico do cliente. Decisão do dono:
--        reunião passada com horas nunca some do portal por causa do Google.
--      · cancelado_google SEM timer → google_removed_at (semântica "removida no
--        Google", já usada pelo núcleo).
-- ---------------------------------------------------------------------
create or replace function _mgr_resolve_past_gone(p_meeting uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_timer boolean;
begin
  if p_reason = 'cancelado_google' then
    select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_timer;
    if v_timer then
      -- Tem horas: nunca sai do portal do cliente → missing, não removed.
      update meetings
         set google_missing_at = coalesce(google_missing_at, now())
       where id = p_meeting;
    else
      update meetings
         set google_removed_at = coalesce(google_removed_at, now())
       where id = p_meeting and google_removed_at is null;
    end if;
  else  -- nao_encontrada
    update meetings
       set google_missing_at = coalesce(google_missing_at, now())
     where id = p_meeting;
  end if;
  -- Se já havia linha pendente daquela reunião (enfileirada antes desta regra),
  -- fecha como superado/reuniao_passada — a fila não guarda o caso já resolvido.
  perform _mgr_close_superseded(p_meeting, 'reuniao_passada');
end;
$$;
revoke all on function _mgr_resolve_past_gone(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Notificação ao dono quando o evento FUTURO foi apagado no Google
--    ((b) removida / (c) mantida). Dedupe por reunião. Sem travessões.
-- ---------------------------------------------------------------------
create or replace function _mgr_notify_evento_apagado(
  p_meeting uuid, p_owner uuid, p_title text, p_kept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if exists (select 1 from notifications
              where type = 'agenda_evento_apagado' and source_id = p_meeting) then
    return;  -- uma vez por reunião
  end if;
  select company_id into v_company from meetings where id = p_meeting;
  if p_kept then
    perform push_notification(p_owner, 'agenda_evento_apagado',
      'Evento da reunião "' || coalesce(p_title, '(sem título)') || '" apagado no Google',
      'O evento foi apagado na sua agenda Google. A reunião foi mantida no CRM porque tem horas registradas.',
      v_company, 'meeting', p_meeting, null);
  else
    perform push_notification(p_owner, 'agenda_evento_apagado',
      'Reunião "' || coalesce(p_title, '(sem título)') || '" removida do CRM',
      'A reunião foi removida do CRM porque o evento foi apagado na sua agenda Google.',
      v_company, 'meeting', p_meeting, null);
  end if;
end;
$$;
revoke all on function _mgr_notify_evento_apagado(uuid, uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. (b)/(c) Auto-resolve uma reunião FUTURA ausente/cancelada: notifica o dono e
--    aplica pelo mesmo caminho do admin. O núcleo (_apply_meeting_google_change
--    cancel) re-decide: futura SEM timer EXCLUI (b); futura COM timer MANTÉM e
--    marca google_removed_at (c). Fecha antes a pendência superada daquela
--    reunião (como 0178). A notificação sai ANTES de aplicar (na exclusão a linha
--    some; source_id não tem FK, mas mantém a ordem limpa).
-- ---------------------------------------------------------------------
create or replace function _mgr_future_gone_apply(p_meeting uuid, p_owner uuid, p_title text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_timer boolean;
begin
  select exists (select 1 from meeting_timers t where t.meeting_id = p_meeting) into v_timer;
  perform _mgr_notify_evento_apagado(p_meeting, p_owner, p_title, v_timer);
  perform _mgr_close_superseded(p_meeting, 'aplicado_automaticamente');
  perform _apply_meeting_google_change(p_meeting, null, null, null, null, true);
end;
$$;
revoke all on function _mgr_future_gone_apply(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. ENFILEIRAR (varredura do dono / ausentes do sync completo) — reescrito com
--    as regras a–e. Passadas resolvidas inline (a); futuras ausentes/canceladas
--    coletadas e, após o laço, auto-resolvidas (b/c) OU, se mais de 3 futuras no
--    mesmo lote, todas para a fila como muitos_cancelamentos (d). Demais motivos
--    continuam indo para a fila. Base: 0174 §8.
-- ---------------------------------------------------------------------
create or replace function meeting_reconcile_enqueue(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_email  text;
  v_op     jsonb;
  v_cur    record;
  v_motivo text;
  v_count  int := 0;                 -- itens EFETIVAMENTE enfileirados
  v_future_gone jsonb[] := '{}';     -- ops de reunião FUTURA ausente/cancelada
  v_el     jsonb;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  select google_email into v_email from google_accounts where user_id = v_user;

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin
      select m.id, m.title, m.starts_at, m.ends_at, m.google_email,
             m.google_sync_status, m.google_missing_at
        into v_cur
        from meetings m
       where m.created_by = v_user
         and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null
       limit 1;
      if not found then continue; end if;

      v_motivo := nullif(v_op->>'motivo', '');

      -- A3: conta diferente/incerta sobrepõe qualquer outro motivo (o estado lido
      -- pode nem ser do evento certo). Continua na fila + aviso (d).
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

      -- (a)/(e) EVENTO AUSENTE (404/410) — nunca é cancelamento.
      if v_motivo = 'nao_encontrada' then
        if v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'nao_encontrada');   -- (a)
        elsif v_cur.google_missing_at is null then
          update meetings set google_missing_at = now() where id = v_cur.id;  -- (e) 1ª
        else
          v_future_gone := v_future_gone || v_op;                        -- (e) 2ª → b/c
        end if;
        continue;
      end if;

      -- (a)/(b/c) CANCELAMENTO EXPLÍCITO no Google (status=cancelled).
      if coalesce((v_op->>'cancel')::boolean, false) then
        if v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'cancelado_google');  -- (a)
        else
          v_future_gone := v_future_gone || v_op;                        -- (b/c) pós-laço
        end if;
        continue;
      end if;

      -- (d) demais motivos continuam na fila (recorrente, edicao_pendente,
      -- sem_horario, horario_invalido, erro_interno).
      if v_motivo is not null then
        perform _mgr_upsert(v_cur.id, v_user, v_op, v_motivo);
        v_count := v_count + 1;
        continue;
      end if;

      -- Op lida com sucesso (evento existe): limpa a marca de ausente.
      update meetings set google_missing_at = null
       where id = v_cur.id and google_missing_at is not null;

      -- Validações (iguais ao apply).
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

  -- (d) Teto de auto-remoções FUTURAS no mesmo lote. Só reuniões FUTURAS entram
  -- aqui; as passadas já foram resolvidas (a) e não contam para o limite.
  if coalesce(array_length(v_future_gone, 1), 0) > 3 then
    foreach v_el in array v_future_gone loop
      begin
        select m.id into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (v_el->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _mgr_upsert(v_cur.id, v_user, v_el, 'muitos_cancelamentos');
          v_count := v_count + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  else
    foreach v_el in array v_future_gone loop
      begin
        select m.id, m.title into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (v_el->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _mgr_future_gone_apply(v_cur.id, v_user, v_cur.title);  -- (b/c)
        end if;
      exception when others then null;
      end;
    end loop;
  end if;

  update google_calendar_import_state set last_reconcile_scan_at = now() where user_id = v_user;
  return jsonb_build_object('enqueued', v_count);
end;
$$;
revoke execute on function meeting_reconcile_enqueue(jsonb) from public, anon, authenticated;
grant  execute on function meeting_reconcile_enqueue(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. AUTO-SYNC (apply) — regras a–e no ramo RECONCILIADO; só a regra (a) no ramo
--    NÃO reconciliado (o resto continua na fila como antes). Base: 0178.
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
  v_future_gone jsonb[] := '{}';   -- ramo reconciliado: futuras ausentes/canceladas
  c         jsonb;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;

  select auto_apply_from is not null into v_trusted
    from google_calendar_import_state where user_id = v_user;
  select google_email into v_email from google_accounts where user_id = v_user;

  -- -------- NÃO RECONCILIADO: tudo para a fila, EXCETO a regra (a) (passada
  -- ausente/cancelada → resolve, não enfileira).
  if not coalesce(v_trusted, false) then
    for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
      begin
        select m.id, m.title, m.starts_at, m.ends_at, m.google_pushed_at,
               m.google_email, m.google_sync_status
          into v_cur
          from meetings m
         where m.created_by = v_user
           and m.google_event_id = (v_op->>'eventId')
           and m.google_removed_at is null
         limit 1;
        if not found then continue; end if;

        v_motivo := nullif(v_op->>'motivo', '');

        -- (a) passada ausente: resolve, não enfileira (vale também aqui).
        if v_motivo = 'nao_encontrada' and v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'nao_encontrada');
          continue;
        end if;

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
          -- (a) passada cancelada: resolve; futura segue para a fila como antes.
          if v_cur.ends_at < now() then
            perform _mgr_resolve_past_gone(v_cur.id, 'cancelado_google');
            continue;
          end if;
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
        v_upd := nullif(v_op->>'updated', '')::timestamptz;
        if v_upd is not null and v_cur.google_pushed_at is not null
           and v_upd <= v_cur.google_pushed_at then
          continue;
        end if;
        if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
             = coalesce(v_cur.title, '')
           and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
           and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
          continue;
        end if;
        perform _mgr_upsert(v_cur.id, v_user, v_op, null);
        v_queued := v_queued + 1;
      exception when others then
        begin
          perform _mgr_upsert(v_cur.id, v_user, v_op, 'erro_interno');
          v_queued := v_queued + 1;
        exception when others then null;
        end;
      end;
    end loop;
    return jsonb_build_object('applied', 0, 'queued', v_queued, 'trusted', false);
  end if;

  -- -------- RECONCILIADO: regras a–e.
  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    begin  -- A6: um item inválido não derruba o lote
      select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.google_pushed_at,
             m.google_email, m.google_sync_status, m.google_missing_at
        into v_cur
        from meetings m
       where m.created_by = v_user
         and m.google_event_id = (v_op->>'eventId')
         and m.google_removed_at is null
       limit 1;
      if not found then continue; end if;

      v_motivo := nullif(v_op->>'motivo', '');

      -- (a)/(e) evento ausente — antes do encaminhamento genérico de motivo.
      if v_motivo = 'nao_encontrada' then
        if v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'nao_encontrada');   -- (a)
          v_applied := v_applied + 1;
        elsif v_cur.google_missing_at is null then
          update meetings set google_missing_at = now() where id = v_cur.id;  -- (e) 1ª
        else
          v_future_gone := v_future_gone || v_op;                        -- (e) 2ª → b/c
        end if;
        continue;
      end if;

      -- Motivo vindo do servidor (dia inteiro, recorrente etc.): direto p/ fila.
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

      -- (a)/(b/c) cancelamento explícito.
      if coalesce((v_op->>'cancel')::boolean, false) then
        if v_cur.ends_at < now() then
          perform _mgr_resolve_past_gone(v_cur.id, 'cancelado_google');  -- (a)
          v_applied := v_applied + 1;
        else
          v_future_gone := v_future_gone || v_op;                        -- (b/c) pós-laço
        end if;
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

      -- Guarda anti-desfazer (0176) + diff SEM meet_link (A7).
      v_upd := nullif(v_op->>'updated', '')::timestamptz;
      if v_upd is not null and v_cur.google_pushed_at is not null
         and v_upd <= v_cur.google_pushed_at then
        continue;
      end if;
      if coalesce(nullif(btrim(v_op->>'title'), ''), '(sem título)')
           = coalesce(v_cur.title, '')
         and (v_op->>'startsAt')::timestamptz = v_cur.starts_at
         and (v_op->>'endsAt')::timestamptz = v_cur.ends_at then
        continue;
      end if;

      -- Aplicou sozinho: o pendente daquela reunião está superado (0178).
      perform _mgr_close_superseded(v_cur.id, 'aplicado_automaticamente');
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

  -- (d) Teto de auto-remoções FUTURAS por execução (passadas já resolvidas, não
  -- contam). Mais de 3 → todas para a fila como muitos_cancelamentos; senão,
  -- auto-resolve cada uma (b/c) com aviso ao dono.
  if coalesce(array_length(v_future_gone, 1), 0) > 3 then
    foreach c in array v_future_gone loop
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
    foreach c in array v_future_gone loop
      begin
        select m.id, m.title into v_cur from meetings m
         where m.created_by = v_user and m.google_event_id = (c->>'eventId')
           and m.google_removed_at is null limit 1;
        if found then
          perform _mgr_future_gone_apply(v_cur.id, v_user, v_cur.title);  -- (b/c)
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
-- 7. LIMPEZA dos itens atuais (CONFERÊNCIA ANTES feita por MCP: 19 = 13
--    nao_encontrada + 6 cancelado_google, todos cancel_keep passados). Aborta se
--    o número divergir muito (defesa; o dono já validou o número esperado).
--    Fecha cada item como superado/reuniao_passada e marca a reunião conforme
--    (a) — tudo via _mgr_resolve_past_gone (marca + fecha). Nada é apagado.
-- ---------------------------------------------------------------------
do $$
declare v_n int; v_rec record;
begin
  select count(*) into v_n
    from meeting_google_reconciliation r
    join meetings m on m.id = r.meeting_id
   where r.status = 'pending' and r.proposed_action = 'cancel_keep'
     and r.motivo in ('nao_encontrada','cancelado_google') and m.ends_at < now();

  raise notice '0179 limpeza: % itens pending cancel_keep passados (nao_encontrada/cancelado_google).', v_n;
  if v_n > 50 then
    raise exception '0179 ABORTADA: esperava ~19 itens para superar, encontrei %. Confira manualmente antes de aplicar.', v_n;
  end if;

  for v_rec in
    select r.meeting_id, r.motivo
      from meeting_google_reconciliation r
      join meetings m on m.id = r.meeting_id
     where r.status = 'pending' and r.proposed_action = 'cancel_keep'
       and r.motivo in ('nao_encontrada','cancelado_google') and m.ends_at < now()
  loop
    perform _mgr_resolve_past_gone(v_rec.meeting_id, v_rec.motivo);
  end loop;
end;
$$;
