-- =====================================================================
-- 0177 — Conexão/troca de conta Google: liberação automática, conta única,
--        troca segura, defesa no envio e auditoria da troca de empresa do timer.
-- =====================================================================
-- Fecha as falhas do reteste (usuário desenvolvedor Yuri Teste 2):
--
--  FALHA 1  Usuário recém-conectado ficava "não reconciliado" sem ter nada a
--           reconciliar: google_calendar_import_state nasce com auto_apply_from
--           nulo e só o "Concluir" do admin preenchia. Resultado: toda mudança
--           feita no Google numa reunião do CRM ia para a fila, calada.
--           → google_mark_reconciled_if_clean(): libera o auto-sync (seta
--             auto_apply_from) SOMENTE se o usuário não tem reunião FUTURA ligada
--             ao Google criada ANTES da conexão atual (nada a reconciliar).
--             Chamada no callback (após salvar a conta) e no início do sync.
--             Nunca sobrescreve auto_apply_from já preenchido.
--
--  FALHA 3  Troca de conta Google ("Reconectar com outra conta"):
--           · a mesma conta Google podia ficar ligada a DOIS usuários do CRM;
--           · o audit só dizia "conectado", sem a conta de origem/destino;
--           · o import_state guardava o sync_token da conta ANTIGA → o sync
--             seguinte era incremental com token velho e importava 0 eventos;
--           · reuniões futuras na conta antiga não iam para a fila nem avisavam;
--           · arrastar no CRM uma reunião da conta antiga criava evento NOVO na
--             conta nova e deixava o antigo órfão.
--           → google_connect_account(): valida no servidor (auth.uid()):
--             (1) conta já em uso por outro usuário  → recusa, nada é salvo;
--             (2) trava de troca olhando as REUNIÕES (não a linha da conta): se o
--                 usuário tem reunião futura ligada ao Google cujo google_email é
--                 conhecido e diferente do e-mail que está conectando → recusa,
--                 nada é salvo. Vale para QUALQUER caminho, inclusive desconectar
--                 e reconectar com outra conta (sem linha em google_accounts);
--             (3) troca in-place permitida → atualiza connected_at, ZERA o estado
--                 de sync (sync_token/window/last_full) forçando sync completo,
--                 APAGA o espelho imported_google_events da conta antiga, audita
--                 'conta_trocada' {de, para} e chama mark_reconciled_if_clean.
--             + índice único em lower(google_email) como backstop do banco.
--           → google_delete_account(): Desconectar passa a limpar como a troca —
--             apaga imported_google_events e zera sync_token/window/last_full
--             (mantém auto_apply_from).
--
--  ITEM 4   Trocar a empresa de uma reunião com timer movia as horas
--           (meetings_timer_sync) sem registro em meeting_timer_audit.
--           → coluna from_company_id + event_type 'empresa_alterada'; o próprio
--             meetings_timer_sync grava o evento (de→para, quem, quando).
--
-- CONFERÊNCIA ANTES (gate): a seção 0 ABORTA a migração se houver qualquer
-- lower(google_email) ligado a mais de um usuário — o índice único falharia no
-- meio. Remova o duplicado (hoje: Yuri Teste 2 → yurimateusfranco@gmail.com) e
-- rode de novo.
--
-- Convenção de grants (0173): toda função nova/recriada → revoke public, anon
-- (e authenticated nos helpers internos) + grant explícito só a quem usa.
-- Reversão: supabase/rollback/0177_agenda_conexao_troca_conta.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. CONFERÊNCIA (gate) — nenhuma conta Google ligada a 2+ usuários.
-- ---------------------------------------------------------------------
do $$
declare v_dups text;
begin
  select string_agg(format('%s (%s usuários)', email_lower, n), '; ')
    into v_dups
  from (
    select lower(google_email) as email_lower, count(*) as n
      from google_accounts
     group by lower(google_email)
    having count(*) > 1
  ) q;
  if v_dups is not null then
    raise exception
      'Abortado: há conta Google ligada a mais de um usuário do CRM (%). Desfaça o duplicado antes de aplicar a 0177.', v_dups;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Auditoria do Google — novas ações no CHECK.
--    'reconciliado_auto' = liberação automática do auto-sync (FALHA 1).
--    'conta_trocada'     = troca de conta com {de, para} no detail (FALHA 3).
-- ---------------------------------------------------------------------
alter table google_calendar_audit drop constraint google_calendar_audit_action_check;
alter table google_calendar_audit add constraint google_calendar_audit_action_check
  check (action in ('conectado', 'desconectado', 'revogado', 'erro_revogacao',
                    'reconciliado_auto', 'conta_trocada'));

-- ---------------------------------------------------------------------
-- 2. Liberação automática do auto-sync (FALHA 1).
--    Seta auto_apply_from = now() SÓ se o usuário não tem NADA a reconciliar:
--    nenhuma reunião FUTURA (starts_at > now()) ligada ao Google (google_event_id
--    não nulo, não removida) criada ANTES da conexão atual — essas é que podem
--    estar fora de sincronia com a conta recém-conectada. Nunca sobrescreve um
--    auto_apply_from já preenchido. Audita 'reconciliado_auto' quando marca.
--    Retorna true só quando efetivamente marcou.
-- ---------------------------------------------------------------------
create or replace function google_mark_reconciled_if_clean()
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_connected timestamptz;
  v_existing  timestamptz;
begin
  if v_user is null then
    raise exception 'google_mark_reconciled_if_clean: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;

  select connected_at into v_connected from google_accounts where user_id = v_user;
  if v_connected is null then return false; end if;  -- sem conta conectada

  -- Já reconciliado: nunca sobrescreve (decisão).
  select auto_apply_from into v_existing
    from google_calendar_import_state where user_id = v_user;
  if v_existing is not null then return false; end if;

  -- Tem algo a reconciliar? Reunião futura ligada ao Google, viva, criada ANTES
  -- da conexão atual (pode divergir da conta recém-conectada).
  if exists (
    select 1 from meetings m
     where m.created_by = v_user
       and m.starts_at > now()
       and m.google_event_id is not null
       and m.google_removed_at is null
       and m.created_at < v_connected
  ) then
    return false;
  end if;

  insert into google_calendar_import_state (user_id, auto_apply_from, updated_at)
  values (v_user, now(), now())
  on conflict (user_id) do update set auto_apply_from = now(), updated_at = now()
    where google_calendar_import_state.auto_apply_from is null;  -- backstop: nunca sobrescreve

  insert into google_calendar_audit (user_id, action, detail)
  values (v_user, 'reconciliado_auto',
          'Auto-sync liberado: sem reuniões futuras a reconciliar na conexão atual.');
  return true;
end;
$$;
revoke all on function google_mark_reconciled_if_clean() from public, anon;
grant  execute on function google_mark_reconciled_if_clean() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Conexão/troca de conta com validação no servidor (FALHA 3).
--    Única porta do callback para gravar a conta (substitui a chamada direta a
--    google_upsert_account). Retorna jsonb com 'status':
--      'conta_em_uso'    — a conta Google já pertence a outro usuário; nada salvo;
--      'troca_bloqueada' — há reunião futura na conta atual; nada salvo (+count,email);
--      'conectado'       — primeira conexão ou reconsentimento da MESMA conta;
--      'trocada'         — troca concluída (estado de sync zerado, espelho apagado).
--    DEFINER para enxergar google_accounts de OUTROS usuários (conta_em_uso).
-- ---------------------------------------------------------------------
create or replace function google_connect_account(
  p_email text, p_access text, p_refresh text,
  p_expiry timestamptz, p_scope text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user          uuid := auth.uid();
  v_old_email     text;
  v_is_swap       boolean;
  v_future        int;
  v_blocked_email text;
begin
  if v_user is null then
    raise exception 'google_connect_account: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;

  -- (1) Conta já em uso por OUTRO usuário do CRM → recusa; nada é salvo.
  if exists (
    select 1 from google_accounts
     where lower(google_email) = lower(p_email) and user_id <> v_user
  ) then
    return jsonb_build_object('status', 'conta_em_uso');
  end if;

  -- (2) Trava de troca por REUNIÕES, não pela linha da conta (vale para QUALQUER
  --     caminho de conexão, inclusive desconectar e reconectar com outra conta —
  --     aí não há mais linha em google_accounts, mas as reuniões futuras seguem
  --     apontando a conta antiga). Bloqueia a conexão de X se o usuário tem
  --     reunião FUTURA ligada ao Google cujo google_email é conhecido e diferente
  --     de X. google_email nulo (conta incerta) não bloqueia. Nada é salvo.
  select count(*),
         (select m2.google_email
            from meetings m2
           where m2.created_by = v_user and m2.starts_at > now()
             and m2.google_event_id is not null and m2.google_removed_at is null
             and m2.google_email is not null and lower(m2.google_email) <> lower(p_email)
           group by m2.google_email order by count(*) desc limit 1)
    into v_future, v_blocked_email
    from meetings m
   where m.created_by = v_user and m.starts_at > now()
     and m.google_event_id is not null and m.google_removed_at is null
     and m.google_email is not null and lower(m.google_email) <> lower(p_email);
  if v_future > 0 then
    return jsonb_build_object('status', 'troca_bloqueada',
                              'count', v_future,
                              'email', coalesce(v_blocked_email, 'outra conta'));
  end if;

  -- Conta atual (se houver) só decide a LIMPEZA da troca in-place abaixo.
  select google_email into v_old_email from google_accounts where user_id = v_user;
  v_is_swap := v_old_email is not null and lower(v_old_email) <> lower(p_email);

  -- Grava a conta (cifra tokens + audita 'conectado'); reusa a função da 0043.
  perform google_upsert_account(p_email, p_access, p_refresh, p_expiry, p_scope);

  if v_is_swap then
    -- connected_at vira AGORA (o on-conflict do upsert não o altera).
    update google_accounts set connected_at = now() where user_id = v_user;
    -- Estado de sync da conta ANTIGA zera: força sync COMPLETO da conta nova
    -- (senão o incremental com token velho importa 0 eventos).
    update google_calendar_import_state
       set sync_token = null, window_start = null, window_end = null,
           last_full_sync_at = null, updated_at = now()
     where user_id = v_user;
    -- Espelho importado é da conta antiga: apaga (o sync completo repovoa).
    delete from imported_google_events where user_id = v_user;
    -- Auditoria da troca, com conta de origem e destino.
    insert into google_calendar_audit (user_id, action, detail)
    values (v_user, 'conta_trocada',
            jsonb_build_object('de', v_old_email, 'para', p_email)::text);
  end if;

  -- Liberação automática se não houver nada a reconciliar (FALHA 1).
  perform google_mark_reconciled_if_clean();

  return jsonb_build_object('status', case when v_is_swap then 'trocada' else 'conectado' end);
end;
$$;
revoke all on function google_connect_account(text, text, text, timestamptz, text) from public, anon;
grant  execute on function google_connect_account(text, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3b. Desconectar alinhado à troca: além de apagar a conta e auditar, limpa o
--     espelho importado (imported_google_events) e ZERA o estado de sync
--     (sync_token/window/last_full) do usuário — senão um reconectar reaproveita
--     token e janela da conta antiga. MANTÉM auto_apply_from (decisão). Redefine
--     a função da 0043 preservando a assinatura e a auditoria.
-- ---------------------------------------------------------------------
create or replace function google_delete_account(p_revoked boolean)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'google_delete_account: sem sessão (auth.uid() nulo)'
      using errcode = '28000';
  end if;
  delete from google_accounts where user_id = v_user;
  -- Limpeza (igual à troca de conta): o espelho e o estado de sync são da conta
  -- que acabou de sair. auto_apply_from NÃO é tocado.
  update google_calendar_import_state
     set sync_token = null, window_start = null, window_end = null,
         last_full_sync_at = null, updated_at = now()
   where user_id = v_user;
  delete from imported_google_events where user_id = v_user;
  insert into google_calendar_audit (user_id, action)
  values (v_user, case when p_revoked then 'revogado' else 'desconectado' end);
end;
$$;
revoke all on function google_delete_account(boolean) from public, anon;
grant  execute on function google_delete_account(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Backstop do banco: uma conta Google, um usuário (FALHA 3).
--    A seção 0 garante que não há duplicados ao criar o índice.
-- ---------------------------------------------------------------------
create unique index if not exists google_accounts_email_lower_uniq
  on google_accounts (lower(google_email));

-- ---------------------------------------------------------------------
-- 5. ITEM 4 — auditoria da troca de EMPRESA de reunião com timer.
--    Coluna from_company_id (só em 'empresa_alterada') + o tipo no CHECK.
-- ---------------------------------------------------------------------
alter table meeting_timer_audit add column if not exists from_company_id uuid;
comment on column meeting_timer_audit.from_company_id is
  'Empresa de ORIGEM no evento empresa_alterada (ITEM 4/0177). company_id guarda a de destino. null nos demais tipos.';

alter table meeting_timer_audit drop constraint meeting_timer_audit_event_type_check;
alter table meeting_timer_audit add constraint meeting_timer_audit_event_type_check
  check (event_type = any (array['edit'::text, 'auto_close'::text,
                                 'company_delete'::text, 'empresa_alterada'::text]));

-- meetings_timer_sync (0175 §3): além de propagar início/fim/empresa ao timer,
-- registra a troca de EMPRESA na auditoria do timer. edited_by = auth.uid() (quem
-- editou a reunião no CRM); old/new_seconds = total atual (new_seconds é NOT NULL,
-- guarda o mesmo total nos dois — a troca não altera as horas).
create or replace function meetings_timer_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_t     record;
  v_total bigint;
begin
  update meeting_timers
     set scheduled_start = new.starts_at,
         scheduled_end   = new.ends_at,
         company_id      = new.company_id
   where meeting_id = new.id;

  if new.company_id is distinct from old.company_id then
    for v_t in select id, title, started_by from meeting_timers where meeting_id = new.id loop
      v_total := meeting_timer_total_seconds(v_t.id);
      insert into meeting_timer_audit
        (timer_id, company_id, from_company_id, title, started_by, edited_by, edited_at,
         old_seconds, new_seconds, justification, event_type)
      values
        (v_t.id, new.company_id, old.company_id, v_t.title, v_t.started_by, auth.uid(), now(),
         v_total, v_total,
         'Empresa da reunião alterada: as horas do timer passam a contar na empresa de destino.',
         'empresa_alterada');
    end loop;
  end if;
  return new;
end; $$;

drop trigger if exists trg_meetings_timer_sync on meetings;
create trigger trg_meetings_timer_sync
  after update of starts_at, ends_at, company_id on meetings
  for each row execute function meetings_timer_sync();

-- Histórico do timer: devolve também as empresas de origem/destino para a UI
-- mostrar "Empresa alterada de A para B por Fulano". Return muda → DROP+CREATE.
drop function if exists meeting_timer_audit_list(uuid);
create function meeting_timer_audit_list(p_timer uuid)
returns table(
  event_type text, edited_at timestamptz, edited_by uuid, editor_name text,
  old_seconds bigint, new_seconds bigint, justification text,
  from_company_name text, to_company_name text
)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '28000'; end if;

  select a.company_id, a.started_by into v_company, v_owner
    from meeting_timer_audit a where a.timer_id = p_timer limit 1;
  if not found then
    return; -- sem histórico: nada a mostrar
  end if;

  if not ((select is_admin())
          or v_owner = (select auth.uid())
          or v_company in (select my_consultant_companies())) then
    raise exception 'Histórico de reunião restrito.' using errcode = '42501';
  end if;

  return query
    select a.event_type, a.edited_at, a.edited_by,
           case when a.edited_by is null then null
                else (select d.name from display_profiles(array[a.edited_by]::uuid[]) d) end,
           a.old_seconds, a.new_seconds, a.justification,
           (select c.name from companies c where c.id = a.from_company_id),
           (select c.name from companies c where c.id = a.company_id)
      from meeting_timer_audit a
     where a.timer_id = p_timer
     order by a.edited_at desc;
end;
$$;
revoke execute on function meeting_timer_audit_list(uuid) from public, anon;
grant  execute on function meeting_timer_audit_list(uuid) to authenticated;
