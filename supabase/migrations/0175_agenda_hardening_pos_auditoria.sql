-- =====================================================================
-- 0175 — Endurecimento pós-auditoria da Agenda (rodada seguinte aos commits
-- 0172/0174): achados 4 (RLS de UPDATE), 5 (setSync vira RPC com erro checado),
-- 7 (troca de empresa propaga ao timer) e 11 (horas preservadas em snapshot
-- quando a empresa é excluída).
--
-- COMPATIBILIDADE COM O FRONT DE PRODUÇÃO (regra: nunca banco antes do front):
-- o setSync antigo, em produção, escreve DIRETO google_event_id/meet_link/
-- google_sync_status/google_sync_error. Por isso o guard abaixo só trava o que
-- o front de produção NUNCA escreve (google_email forjado, google_removed_at,
-- google_missing_at, client_hidden, company_id sem alcance). O aperto do
-- restante (event_id/meet/status só via RPC) fica para DEPOIS do deploy do
-- front novo, que já usa a RPC meetings_set_sync desta migração.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Achado 4 — guard de UPDATE em meetings (condicionado à MUDANÇA, por isso
--    trigger e não with_check: a policy avaliaria a linha inteira e passaria a
--    barrar QUALQUER edição de um criador que perdeu o alcance da empresa,
--    inclusive o setSync de produção).
--    · company_id só muda para empresa que o criador ALCANÇA (mesma regra do
--      INSERT: admin ∨ consultor ∨ colaborador ∨ tráfego ∨ dev).
--    · google_email só muda JUNTO com google_event_id e para a conta Google
--      ATUAL do criador (é o que o gatilho de preenchimento da 0174 faz; forjar
--      outra conta reabilitaria o auto-sync numa reunião de conta incerta).
--    · google_removed_at / google_missing_at / client_hidden não mudam por
--      UPDATE direto — só pelas funções DEFINER (sync, fila, set_meeting_client_hidden,
--      meetings_set_sync).
--    O guard só vale para a sessão comum (current_user = authenticated/anon);
--    funções SECURITY DEFINER rodam como o dono e passam direto. Por isso a
--    função é INVOKER (com DEFINER o current_user interno seria sempre o dono
--    e a isenção valeria para todo mundo). As leituras internas rodam como o
--    próprio criador: google_accounts dele (RLS own-row) e os helpers de
--    alcance, que já são DEFINER.
--    ORDEM: o nome trg_meetings_guard_update ordena DEPOIS de
--    trg_meetings_fill_google_email (f < g), então o guard vê o e-mail já
--    preenchido pelo fill e o reconhece como legítimo.
-- ---------------------------------------------------------------------
create or replace function meetings_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;  -- escrita via função DEFINER: as próprias funções validam
  end if;

  if new.company_id is distinct from old.company_id then
    if not ((select is_admin())
            or new.company_id in (select my_consultant_companies())
            or new.company_id in (select my_collaborator_companies())
            or new.company_id in (select my_traffic_companies())
            or new.company_id in (select my_dev_companies())) then
      raise exception 'Você não tem acesso à empresa de destino desta reunião.'
        using errcode = '42501';
    end if;
  end if;

  if new.google_email is distinct from old.google_email then
    if new.google_event_id is not distinct from old.google_event_id
       or new.google_email is distinct from
          (select ga.google_email from google_accounts ga where ga.user_id = new.created_by) then
      raise exception 'A conta Google da reunião é controlada pelo sistema e não pode ser alterada diretamente.'
        using errcode = '42501';
    end if;
  end if;

  if new.google_removed_at is distinct from old.google_removed_at
     or new.google_missing_at is distinct from old.google_missing_at then
    raise exception 'As marcas de remoção do Google são controladas pela sincronização e não podem ser alteradas diretamente.'
      using errcode = '42501';
  end if;

  if new.client_hidden is distinct from old.client_hidden then
    raise exception 'A visibilidade ao cliente muda apenas pelo botão próprio (função do sistema).'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function meetings_guard_update() from public, anon, authenticated;

drop trigger if exists trg_meetings_guard_update on meetings;
create trigger trg_meetings_guard_update
  before update on meetings
  for each row execute function meetings_guard_update();

-- ---------------------------------------------------------------------
-- 2. Achado 5 — gravação do resultado da sincronização vira RPC (DEFINER), com
--    validação no banco: só o CRIADOR, status do domínio e e-mail = conta Google
--    atual dele (anti-forja). Sucesso com evento limpa google_removed_at e
--    google_missing_at (reunião ressuscitada volta ao portal/conflito/sync).
--    O front novo chama esta RPC e CHECA o erro (antes o update era solto: se a
--    gravação falhasse depois de o Google criar o evento, o event_id se perdia e
--    o reenvio duplicava o evento na agenda).
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
-- 3. Achado 7 — trocar a empresa da reunião propaga ao timer: as horas passam a
--    contar na empresa certa (company_meeting_hours/sessions e Capacidade leem
--    meeting_timers.company_id, que era cópia do momento do início).
-- ---------------------------------------------------------------------
create or replace function meetings_timer_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update meeting_timers
     set scheduled_start = new.starts_at,
         scheduled_end   = new.ends_at,
         company_id      = new.company_id
   where meeting_id = new.id;
  return new;
end; $$;

drop trigger if exists trg_meetings_timer_sync on meetings;
create trigger trg_meetings_timer_sync
  after update of starts_at, ends_at, company_id on meetings
  for each row execute function meetings_timer_sync();

-- ---------------------------------------------------------------------
-- 4. Achado 11 — excluir EMPRESA apagava os timers em cascade e as horas sumiam
--    sem rastro. Timers só são apagados por esse cascade (não há outro caminho
--    de DELETE); antes de a linha sumir, grava um snapshot do total na auditoria
--    (meeting_timer_audit não tem FK para companies nem para o timer, então o
--    registro sobrevive). O gatilho de histórico da auditoria tem guard de
--    empresa inexistente e não tenta escrever company_events da empresa que
--    está sendo apagada.
-- ---------------------------------------------------------------------
alter table meeting_timer_audit drop constraint meeting_timer_audit_event_type_check;
alter table meeting_timer_audit add constraint meeting_timer_audit_event_type_check
  check (event_type = any (array['edit'::text, 'auto_close'::text, 'company_delete'::text]));

create or replace function meeting_timers_snapshot_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint := meeting_timer_total_seconds(old.id);
begin
  insert into meeting_timer_audit
    (timer_id, company_id, title, started_by, edited_by, edited_at,
     old_seconds, new_seconds, justification, event_type)
  values
    (old.id, old.company_id, old.title, old.started_by, null, now(),
     v_total, v_total,  -- new_seconds é NOT NULL; snapshot guarda o total nos dois
     'Snapshot automático: o timer foi apagado junto com a empresa; as horas ficam preservadas neste registro.',
     'company_delete');
  return old;
end;
$$;
revoke all on function meeting_timers_snapshot_trg() from public, anon, authenticated;

drop trigger if exists trg_meeting_timers_snapshot on meeting_timers;
create trigger trg_meeting_timers_snapshot
  before delete on meeting_timers
  for each row execute function meeting_timers_snapshot_trg();
