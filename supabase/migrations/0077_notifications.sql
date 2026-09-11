-- =====================================================================
-- CRM/Timer - Monvatti :: Central de notificações (sino)
-- =====================================================================
-- Notificação é para o que ESPERA UMA AÇÃO sua ou o que ACONTECEU COM ALGO SEU.
-- Atividade geral NÃO vira notificação — para isso existe o histórico da
-- empresa (company_events). Sem esse corte o sino vira ruído (só as conclusões
-- de tarefa já seriam ~42/dia). Consome as menções (content_mentions) como uma
-- das fontes; e-mail e tempo real ficam para depois.
--
-- Gerada por TRIGGER (como a auditoria e o histórico). Regras:
--   - NUNCA notifica o próprio autor da ação.
--   - Sem duplicata: uma menção repetida numa reedição não re-notifica (a
--     notificação nasce do INSERT em content_mentions, que só ocorre para
--     menção NOVA).
--   - Uma ação que atinge várias pessoas gera uma notificação por pessoa.
--   - A geração diária do cron (task_instances) NUNCA notifica: as tarefas são
--     notificadas no nível do TEMPLATE (a atribuição), não da instância.
--
-- PERMISSÃO NA LEITURA: a notificação guarda company_id. Se a pessoa perder o
-- acesso àquela empresa, a leitura NÃO mostra nome de cliente nem deixa abrir o
-- conteúdo — validado no banco (user_reaches_company) na RPC de leitura, não só
-- ao gerar.
--
-- RLS: cada um lê só as próprias (user_id = auth.uid()); ninguém lê alheia (nem
-- admin). Escrita só por trigger/RPC SECURITY DEFINER — sem policy de write.
-- =====================================================================

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id),   -- destinatário
  type        text not null check (type in (
                'mencionado', 'resposta_recebida', 'tarefa_atribuida',
                'tarefa_recorrente_atribuida', 'listagem_ajuste_solicitado',
                'reuniao_convite', 'reuniao_cancelada'
              )),
  title       text not null,                            -- frase curta, pronta (sem nome de cliente)
  body        text,                                     -- complemento opcional (título do objeto)
  company_id  uuid references companies(id) on delete cascade,
  source_type text,
  source_id   uuid,
  actor_id    uuid references profiles(id),             -- quem causou (nulo = cliente/sistema)
  created_at  timestamptz not null default now(),
  read_at     timestamptz                               -- nulo = não lida
);

create index idx_notifications_user
  on notifications(user_id, read_at, created_at desc);

alter table notifications enable row level security;

-- Leitura só das próprias. Sem policy de INSERT/UPDATE/DELETE: quem escreve são
-- os gatilhos e as RPCs de marcar-como-lida (SECURITY DEFINER, dono da tabela).
create policy notif_select on notifications for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Helper de inserção. Nunca notifica o próprio autor; ignora destinatário nulo.
-- ---------------------------------------------------------------------
create or replace function push_notification(
  p_user uuid, p_type text, p_title text, p_body text,
  p_company uuid, p_source_type text, p_source_id uuid, p_actor uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null then return; end if;
  if p_actor is not null and p_user = p_actor then return; end if;
  insert into notifications
    (user_id, type, title, body, company_id, source_type, source_id, actor_id)
  values
    (p_user, p_type, p_title, p_body, p_company, p_source_type, p_source_id, p_actor);
end;
$$;

-- ---------------------------------------------------------------------
-- 1) MENÇÃO — nasce do INSERT em content_mentions (já validado/deduplicado lá).
-- ---------------------------------------------------------------------
create or replace function notify_mention()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_title text;
begin
  v_title := case
    when new.source_type in ('chamado', 'chamado_resposta')
      then 'Mencionou você em um chamado'
    else 'Mencionou você em uma atualização'
  end;
  perform push_notification(
    new.mentioned_user_id, 'mencionado', v_title, null,
    new.company_id, new.source_type, new.source_id, new.author_id
  );
  return null;
end;
$$;

create trigger trg_notify_mention
  after insert on content_mentions
  for each row execute function notify_mention();

-- ---------------------------------------------------------------------
-- 2) RESPOSTA RECEBIDA — responderam SUA atualização ou SEU chamado. Notifica o
--    dono do conteúdo raiz (autor da nota / criador do chamado), nunca o autor
--    da resposta. Responder a uma resposta não notifica o autor da resposta-pai
--    (fora do escopo desta fatia; ele só é avisado se for @mencionado).
-- ---------------------------------------------------------------------
create or replace function notify_note_reply()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_company uuid;
begin
  select author_id, company_id into v_owner, v_company
  from company_notes where id = new.note_id;
  perform push_notification(
    v_owner, 'resposta_recebida', 'Respondeu sua atualização', null,
    v_company, 'atualizacao_resposta', new.id, new.author_id
  );
  return null;
end;
$$;

create trigger trg_notify_note_reply
  after insert on company_note_replies
  for each row execute function notify_note_reply();

create or replace function notify_ticket_reply()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_owner uuid;
begin
  select created_by into v_owner from support_tickets where id = new.ticket_id;
  perform push_notification(
    v_owner, 'resposta_recebida', 'Respondeu seu chamado', null,
    null, 'chamado_resposta', new.id, new.author_id
  );
  return null;
end;
$$;

create trigger trg_notify_ticket_reply
  after insert on support_ticket_replies
  for each row execute function notify_ticket_reply();

-- ---------------------------------------------------------------------
-- 3) TAREFA ATRIBUÍDA — a atribuição vive no TEMPLATE (collaborator_id). Notifica
--    na criação e na REatribuição. O cron só cria INSTÂNCIAS, então nunca cai
--    aqui. Pontual (kind=unica) e recorrente (kind=diaria) são tipos distintos.
-- ---------------------------------------------------------------------
create or replace function notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_type text; v_title text; v_actor uuid;
begin
  -- Só na criação ou quando o responsável de fato muda.
  if tg_op = 'UPDATE'
     and new.collaborator_id is not distinct from old.collaborator_id then
    return null;
  end if;

  if new.kind = 'unica' then
    v_type := 'tarefa_atribuida';
    v_title := 'Atribuiu uma tarefa a você';
  else
    v_type := 'tarefa_recorrente_atribuida';
    v_title := 'Você é o novo responsável por uma tarefa diária';
  end if;

  v_actor := coalesce(auth.uid(), new.created_by);
  perform push_notification(
    new.collaborator_id, v_type, v_title, new.title,
    new.company_id, 'task_template', new.id, v_actor
  );
  return null;
end;
$$;

create trigger trg_notify_task_assignment
  after insert or update of collaborator_id on task_templates
  for each row execute function notify_task_assignment();

-- ---------------------------------------------------------------------
-- 4) LISTAGEM — cliente pediu AJUSTE ou CONTESTOU. Notifica o EXECUTOR da
--    listagem (colaborador da tarefa que a produziu). Ator nulo (é o cliente).
-- ---------------------------------------------------------------------
create or replace function notify_listing_validation()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_exec uuid; v_title text;
begin
  if new.author_type <> 'cliente'
     or new.event_type not in ('ajuste_solicitado', 'contestado') then
    return null;
  end if;

  select t.collaborator_id into v_exec
  from listing_results r
  join task_instances t on t.id = r.task_id
  where r.id = new.listing_result_id;

  v_title := case new.event_type
    when 'ajuste_solicitado' then 'Cliente pediu ajuste em uma listagem'
    else 'Cliente contestou uma listagem'
  end;

  perform push_notification(
    v_exec, 'listagem_ajuste_solicitado', v_title, null,
    new.company_id, 'listing_result', new.listing_result_id, null
  );
  return null;
end;
$$;

create trigger trg_notify_listing_validation
  after insert on listing_validations
  for each row execute function notify_listing_validation();

-- ---------------------------------------------------------------------
-- 5) REUNIÃO — convite (novo participante) e cancelamento (reunião excluída).
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

  v_actor := coalesce(auth.uid(), v_created_by);
  perform push_notification(
    new.user_id, 'reuniao_convite', 'Convidou você para uma reunião', v_title,
    v_company, 'meeting', new.meeting_id, v_actor
  );
  return null;
end;
$$;

create trigger trg_notify_meeting_invite
  after insert on meeting_participants
  for each row execute function notify_meeting_invite();

-- BEFORE DELETE: os participantes ainda existem (o cascade os apaga junto).
create or replace function notify_meeting_cancel()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); r record;
begin
  for r in
    select user_id from meeting_participants where meeting_id = old.id
  loop
    perform push_notification(
      r.user_id, 'reuniao_cancelada', 'Cancelou uma reunião', old.title,
      old.company_id, 'meeting', old.id, v_actor
    );
  end loop;
  return old;
end;
$$;

create trigger trg_notify_meeting_cancel
  before delete on meetings
  for each row execute function notify_meeting_cancel();

-- ---------------------------------------------------------------------
-- LEITURA. Redação no banco: quando a pessoa NÃO alcança mais a empresa, some o
-- nome do cliente e o complemento, e a notificação fica não-navegável
-- (reachable=false). Chamado não tem empresa → sempre reachable.
-- SECURITY DEFINER com filtro explícito user_id=auth.uid() (para ler o nome da
-- empresa mesmo quando a RLS de companies já não deixaria — a redação é aqui).
-- ---------------------------------------------------------------------
create or replace function notifications_feed(
  p_filter text default 'all',
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid, type text, title text, body text,
  company_id uuid, company_name text, reachable boolean,
  source_type text, source_id uuid,
  actor_id uuid, actor_name text, actor_avatar_path text,
  created_at timestamptz, read_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    n.id, n.type, n.title,
    case when n.company_id is null
           or user_reaches_company(auth.uid(), n.company_id)
         then n.body else null end as body,
    n.company_id,
    case when n.company_id is not null
           and user_reaches_company(auth.uid(), n.company_id)
         then (select c.name from companies c where c.id = n.company_id)
         else null end as company_name,
    (n.company_id is null
       or user_reaches_company(auth.uid(), n.company_id)) as reachable,
    n.source_type, n.source_id,
    n.actor_id, a.full_name as actor_name, a.avatar_path as actor_avatar_path,
    n.created_at, n.read_at
  from notifications n
  left join profiles a on a.id = n.actor_id
  where n.user_id = auth.uid()
    and (p_filter <> 'unread' or n.read_at is null)
  order by n.created_at desc
  limit greatest(1, least(p_limit, 50)) offset greatest(0, p_offset);
$$;

grant execute on function notifications_feed(text, int, int) to authenticated;

create or replace function notifications_unread_count()
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from notifications
  where user_id = auth.uid() and read_at is null;
$$;

grant execute on function notifications_unread_count() to authenticated;

create or replace function notifications_mark_read(p_ids uuid[])
returns void
language sql security definer set search_path = public
as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
    and id = any (coalesce(p_ids, '{}'::uuid[]));
$$;

grant execute on function notifications_mark_read(uuid[]) to authenticated;

create or replace function notifications_mark_all_read()
returns void
language sql security definer set search_path = public
as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;

grant execute on function notifications_mark_all_read() to authenticated;
