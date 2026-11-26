-- =====================================================================
-- 0176 — Guarda anti-desfazer do Google→CRM deixa de usar updated_at
-- =====================================================================
-- BUG (provado em begin/rollback): a guarda "v_upd <= updated_at → descarta"
-- usava meetings.updated_at, que QUALQUER escrita lateral avança — ocultar do
-- cliente (set_meeting_client_hidden), setSync com falha, refresh de respostas.
-- Sequência fatal: usuário move no Google às 10:00; às 10:05 alguém oculta a
-- reunião do cliente (updated_at = 10:05); o sync chega com updated = 10:00 e é
-- descartado ANTES do diff — e o sync completo reenvia a MESMA op com o MESMO
-- updated, descartada de novo: divergência permanente, sem fila, sem aviso.
--
-- CORREÇÃO: a guarda passa a comparar com meetings.google_pushed_at — o momento
-- do último envio BEM-SUCEDIDO do CRM ao Google (o único instante que de fato
-- diz "o que o Google tinha até aqui veio de nós"). Nulo = sem guarda; o eco do
-- próprio envio continua caindo no diff de título/horário, que já o descarta.
--
-- Quem carimba google_pushed_at:
--   · meetings_set_sync (0175), no ramo de sucesso com evento — front novo;
--   · o setSync do FRONT DE PRODUÇÃO (update direto), via trigger
--     BEFORE UPDATE OF google_event_id: é a ÚNICA escrita authenticated que
--     lista google_event_id no SET (o passo 1 do updateMeeting e o refresh de
--     respostas não listam; o apply Google→CRM também não), e trigger "OF
--     coluna" dispara pela PRESENÇA no SET mesmo com o valor igual — cobre o
--     PATCH de edição, onde o status já era 'sincronizado' e não transiciona.
--
-- BACKFILL: google_pushed_at fica NULO em todas as existentes. O updated_at
-- atual está contaminado exatamente pelas escritas laterais do bug — semear a
-- guarda com ele reintroduziria descartes. Nulo = sem guarda até o próximo
-- envio; as ops carregam o estado ATUAL do Google (lista/GET frescos), então o
-- pior caso sem guarda é aplicar o estado vigente, nunca um histórico.
--
-- meeting_reconcile_apply: "mudou no CRM depois desta detecção" passa a olhar
-- mudança REAL (título/início/fim diferentes do snapshot crm_* da linha) ou um
-- envio ao Google posterior à detecção — não mais updated_at (ocultar do
-- cliente depois da detecção não trava mais o Aplicar).
--
-- Compatível com o front de produção: nada aqui muda assinatura nem exige RPC
-- nova no front; só o banco. (Decisão: nenhuma mudança do Google pode ser
-- descartada em silêncio — ou aplica, ou fila.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Coluna + carimbo
-- ---------------------------------------------------------------------
alter table meetings add column if not exists google_pushed_at timestamptz;

comment on column meetings.google_pushed_at is
  'Último envio BEM-SUCEDIDO do CRM ao Google (INSERT/PATCH do evento). Base da guarda anti-desfazer do auto-sync (0176): op do Google com updated <= google_pushed_at é eco/estado anterior ao nosso envio. null = nunca enviado por este caminho (sem guarda).';

-- INVOKER de propósito: só a escrita DIRETA do front (current_user =
-- authenticated) carimba por aqui; meetings_set_sync roda como o dono e
-- carimba explicitamente no próprio UPDATE.
create or replace function meetings_stamp_pushed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.google_sync_status = 'sincronizado'
     and new.google_event_id is not null then
    new.google_pushed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function meetings_stamp_pushed() from public, anon, authenticated;

drop trigger if exists trg_meetings_stamp_pushed on meetings;
create trigger trg_meetings_stamp_pushed
  before update of google_event_id on meetings
  for each row execute function meetings_stamp_pushed();

-- ---------------------------------------------------------------------
-- 2. meetings_set_sync (0175) — ramo de sucesso carimba google_pushed_at.
--    Mesma assinatura; nada muda para o front.
-- ---------------------------------------------------------------------
create or replace function meetings_set_sync(
  p_meeting   uuid,
  p_status    text,
  p_error     text,
  p_has_event boolean default false,
  p_event_id  text default null,
  p_meet_link text default null,
  p_email     text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_creator uuid;
  v_my_email text;
begin
  if v_user is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if p_status not in ('pendente', 'sincronizado', 'nao_conectado', 'falhou') then
    raise exception 'status de sincronização inválido (%).', coalesce(p_status, 'nulo');
  end if;

  select created_by into v_creator from meetings where id = p_meeting;
  if not found then return; end if;
  if v_creator <> v_user then
    raise exception 'Só quem criou a reunião grava o resultado da sincronização.'
      using errcode = '42501';
  end if;

  if p_has_event then
    if p_email is not null then
      select google_email into v_my_email from google_accounts where user_id = v_user;
      if v_my_email is distinct from p_email then
        raise exception 'A conta Google informada não é a conta conectada deste usuário.'
          using errcode = '42501';
      end if;
    end if;
    update meetings
       set google_sync_status = p_status,
           google_sync_error  = p_error,
           google_event_id    = nullif(p_event_id, ''),
           google_calendar_id = 'primary',
           meet_link          = p_meet_link,
           google_email       = p_email,
           -- O evento acabou de ser gravado no Google COM SUCESSO: marcas de
           -- removida/não encontrada caducam (senão a reunião ressuscitada
           -- ficaria para sempre fora do portal, do conflito e do sync).
           google_removed_at  = null,
           google_missing_at  = null,
           -- Base da guarda anti-desfazer (0176): daqui para trás é eco nosso.
           google_pushed_at   = now(),
           updated_at         = now()
     where id = p_meeting;
  else
    -- nao_conectado/falhou: mantém o event_id anterior DE PROPÓSITO (B14: o
    -- reenvio tenta PATCH nele e só cria evento novo em 404/410).
    update meetings
       set google_sync_status = p_status,
           google_sync_error  = p_error,
           updated_at         = now()
     where id = p_meeting;
  end if;
end;
$$;
revoke all on function meetings_set_sync(uuid, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function meetings_set_sync(uuid, text, text, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. meetings_apply_google_sync — a guarda dos DOIS ramos compara com
--    google_pushed_at (nulo = sem guarda). Resto idêntico à 0175.
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
        -- Guarda anti-desfazer (0176): estado do Google ANTERIOR ao nosso último
        -- envio é eco/obsoleto. updated_at NÃO entra aqui (escrita lateral o
        -- avançava e a mudança real era descartada em silêncio).
        v_upd := nullif(v_op->>'updated', '')::timestamptz;
        if v_upd is not null and v_cur.google_pushed_at is not null
           and v_upd <= v_cur.google_pushed_at then
          continue;
        end if;
        -- Sem divergência real (diff sem meet_link, A7): descarta o eco.
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
      select m.id, m.title, m.starts_at, m.ends_at, m.meet_link, m.google_pushed_at,
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
-- 4. meeting_reconcile_apply — staleness por MUDANÇA REAL: título/início/fim
--    diferentes do snapshot crm_* da linha, ou envio ao Google depois da
--    detecção. Ocultar do cliente (e qualquer escrita lateral) não trava mais.
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

  select title, starts_at, ends_at, google_pushed_at into v_m
    from meetings where id = v_row.meeting_id;
  if v_m.title is distinct from v_row.crm_title
     or v_m.starts_at is distinct from v_row.crm_starts_at
     or v_m.ends_at is distinct from v_row.crm_ends_at
     or (v_m.google_pushed_at is not null and v_m.google_pushed_at > v_row.detected_at) then
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
