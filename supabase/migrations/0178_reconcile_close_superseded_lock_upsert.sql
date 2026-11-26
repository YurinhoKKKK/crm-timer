-- =====================================================================
-- 0178 — Fila de reconciliação: fechar pendências superadas + trava direta
--        de google_upsert_account
-- =====================================================================
-- Dois buracos achados no reteste do deploy b4afdaa:
--
--  (1a) AUTO-SYNC aplica sozinho uma mudança de uma reunião que JÁ tinha item
--       'pending' na fila. O usuário virou reconciliado DEPOIS de o item ser
--       criado (via google_mark_reconciled_if_clean, 0177 — que liga o auto-sync
--       sem olhar a fila), então meetings_apply_google_sync aplica a mudança mas
--       o item antigo fica 'pending' para sempre: polui a fila e TRAVA o
--       "Concluir" do admin para aquele dono (meeting_reconcile_finalize aborta
--       com itens pendentes). → ao aplicar, fecha os pendentes daquela reunião
--       com status 'superado' + resolution_reason 'aplicado_automaticamente'.
--
--  (1b) EXCLUIR uma reunião põe meeting_google_reconciliation.meeting_id em null
--       (FK on delete set null) e o item segue 'pending', órfão. → gatilho BEFORE
--       DELETE fecha os pendentes da reunião ANTES de excluir, com status
--       'superado' + resolution_reason 'reuniao_excluida'.
--
--   (4) google_upsert_account: o front não a chama mais (só google_connect_account,
--       0177, que valida conta única e trava de troca). Chamada DIRETA por um
--       usuário logado via PostgREST pularia essas travas. → revoga EXECUTE de
--       authenticated também. google_connect_account continua chamando-a por ser
--       SECURITY DEFINER (roda como o dono, que mantém o EXECUTE).
--       CONFERÊNCIA: nenhuma chamada a google_upsert_account no src (só o tipo
--       gerado em types.ts) — seguro revogar.
--
-- DECISÃO (mantida): item da fila NUNCA é apagado ao encerrar; só muda de status
-- (histórico). 'superado' é o novo status de encerramento automático; o motivo da
-- ENTRADA na fila (coluna motivo, 0174) é preservado — resolution_reason guarda
-- por que SAIU. meeting_reconcile_list/owners/finalize já filtram status='pending',
-- então 'superado' some da fila e destrava o Concluir.
--
-- Convenção de grants (0173): helper/gatilho internos → revoke all de public,
-- anon, authenticated. Reversão: supabase/rollback/0178_*.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema: status de encerramento 'superado' + motivo da saída.
-- ---------------------------------------------------------------------
alter table meeting_google_reconciliation
  add column if not exists resolution_reason text;
comment on column meeting_google_reconciliation.resolution_reason is
  'Por que a linha SAIU da fila por encerramento automático (0178): aplicado_automaticamente (auto-sync aplicou a mudança sozinho) ou reuniao_excluida (reunião apagada). null quando resolvida pelo admin (applied/dismissed) ou ainda pendente. A coluna motivo (0174) guarda por que ENTROU.';

alter table meeting_google_reconciliation
  drop constraint meeting_google_reconciliation_status_check;
alter table meeting_google_reconciliation
  add constraint meeting_google_reconciliation_status_check
  check (status in ('pending', 'applied', 'dismissed', 'superado'));

-- ---------------------------------------------------------------------
-- 2. Helper: fecha os pendentes de uma reunião como 'superado'. Há no máximo
--    uma linha pendente por reunião (unique(meeting_id)); o update é por
--    segurança idempotente. resolved_by fica null (encerramento sem admin).
-- ---------------------------------------------------------------------
create or replace function _mgr_close_superseded(p_meeting uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update meeting_google_reconciliation
     set status = 'superado',
         resolution_reason = p_reason,
         resolved_at = now()
   where meeting_id = p_meeting and status = 'pending';
end;
$$;
revoke all on function _mgr_close_superseded(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. (1b) Gatilho BEFORE DELETE: fecha os pendentes antes do FK pôr meeting_id
--    em null. Cobre QUALQUER caminho de exclusão (criador, admin_delete_meeting,
--    cancel automático que apaga reunião futura sem timer).
--    Empresa em exclusão (cascade companies→meetings): não mexe na linha — ela
--    some junto (o painel já filtra meeting_id null) e seguimos o mesmo cuidado
--    dos outros gatilhos BEFORE DELETE da tabela (0174 §16).
-- ---------------------------------------------------------------------
create or replace function meetings_close_reconcile_on_delete()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.company_id is not null
     and not exists (select 1 from companies c where c.id = old.company_id) then
    return old;
  end if;
  perform _mgr_close_superseded(old.id, 'reuniao_excluida');
  return old;
end;
$$;
revoke all on function meetings_close_reconcile_on_delete() from public, anon, authenticated;

drop trigger if exists trg_meetings_close_reconcile_on_delete on meetings;
create trigger trg_meetings_close_reconcile_on_delete
  before delete on meetings
  for each row execute function meetings_close_reconcile_on_delete();

-- ---------------------------------------------------------------------
-- 4. (1a) meetings_apply_google_sync (base 0176) — no ramo RECONCILIADO, antes
--    de cada aplicação automática (_apply_meeting_google_change), fecha o
--    pendente daquela reunião como 'aplicado_automaticamente'. Se a aplicação
--    falhar, o bloco exception re-enfileira via _mgr_upsert (volta a 'pending'),
--    então nada some em silêncio. Resto IDÊNTICO à 0176.
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

      -- (1a) Aplicou sozinho: o pendente daquela reunião está superado.
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
          -- (1a) Mesmo encerramento para o cancelamento automático. Se o núcleo
          -- EXCLUIR a reunião (futura sem timer), o gatilho BEFORE DELETE não
          -- re-fecha (já não está 'pending'); fica 'aplicado_automaticamente'.
          perform _mgr_close_superseded(v_cur.id, 'aplicado_automaticamente');
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
-- 5. (4) Trava direta de google_upsert_account: o front só usa
--    google_connect_account (0177). Revoga EXECUTE de authenticated — a chamada
--    interna de google_connect_account (SECURITY DEFINER) segue valendo pelo
--    dono. public/anon já estavam revogados desde a 0043.
-- ---------------------------------------------------------------------
revoke execute on function google_upsert_account(text, text, text, timestamptz, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. (5a) Excluir empresa voltou a funcionar. deleteCompany apaga companies e o
--    cascade remove tarefas/anotações/consultores/etc.; os gatilhos de histórico
--    de 0168 disparam NO MEIO do cascade e chamam log_company_event para a
--    empresa que está sendo apagada — o insert em company_events violava
--    company_events_company_id_fkey (23503) e DESFAZIA a exclusão inteira (toda
--    empresa com tarefa/anotação/consultor ficava impossível de excluir, desde a
--    0168). Guard central: empresa já inexistente → sem histórico a guardar,
--    retorna. (Os gatilhos *_event_trg de meetings que inserem direto já têm o
--    mesmo guard desde a 0174 §3/§16.) Resto da função idêntico.
-- ---------------------------------------------------------------------
create or replace function log_company_event(
  p_company uuid, p_type text, p_summary text,
  p_details jsonb default '{}'::jsonb, p_actor uuid default null,
  p_source text default null, p_source_id text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_company is null then return; end if;
  if not exists (select 1 from companies c where c.id = p_company) then return; end if;
  insert into company_events (company_id, event_type, summary, details, actor_id, source, source_id)
  values (p_company, p_type, p_summary, coalesce(p_details, '{}'::jsonb), p_actor, p_source, p_source_id)
  on conflict (source, source_id) where source is not null do nothing;
end;
$$;
-- Interna (só os gatilhos DEFINER a chamam): mantém o hardening da 0173.
revoke all on function log_company_event(uuid, text, text, jsonb, uuid, text, text)
  from public, anon, authenticated;
