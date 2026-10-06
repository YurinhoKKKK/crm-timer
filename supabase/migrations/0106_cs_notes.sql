-- Quadro "Sucesso do Cliente" (CS): "Atualizações do CS" por empresa — iguais às
-- Atualizações normais em aparência/comportamento, mas em TABELAS PRÓPRIAS e
-- EXCLUSIVAS DE ADMIN. Nenhuma nota do CS aparece/conta nas Atualizações, nos
-- painéis, na central, no portal ou em company_events.
--
-- Espelha company_notes / company_note_replies (mesmos nomes/tipos onde faz
-- sentido) SEM visible_to_client e SEM áreas. Reaproveita a mesma mecânica:
-- sanitização (ponto único no app), menções (content_mentions + RPCs),
-- notificações (push_notification), checkbox na leitura (GUC app.task_checkbox).

-- ===========================================================================
-- 1) Tabelas (espelho de company_notes / company_note_replies)
-- ===========================================================================
create table cs_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  content_html text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid references profiles(id) on delete set null
);
create index cs_notes_company_idx on cs_notes (company_id, created_at desc);

create table cs_note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references cs_notes(id) on delete cascade,
  parent_id uuid references cs_note_replies(id) on delete cascade,
  body_html text not null,
  attachments jsonb not null default '[]'::jsonb,
  author_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index cs_note_replies_note_idx on cs_note_replies (note_id, created_at);

-- ===========================================================================
-- 2) RLS — TUDO exige (select is_admin()); insert exige author = quem grava.
--    Espelha cn_*/cnr_* dentro do universo admin.
-- ===========================================================================
alter table cs_notes enable row level security;
alter table cs_note_replies enable row level security;

create policy cs_notes_select on cs_notes
  for select using ((select is_admin()));
create policy cs_notes_insert on cs_notes
  for insert with check ((select is_admin()) and author_id = (select auth.uid()));
create policy cs_notes_update on cs_notes
  for update using ((select is_admin())) with check ((select is_admin()));
create policy cs_notes_delete on cs_notes
  for delete using ((select is_admin()));

-- Respostas: ler/responder exige admin + nota existente; editar só o autor.
-- (Espelha cnr_select/cnr_insert/cnr_update; sem policy de DELETE, como hoje.)
create policy cs_note_replies_select on cs_note_replies
  for select using ((select is_admin()));
create policy cs_note_replies_insert on cs_note_replies
  for insert with check (
    (select is_admin())
    and author_id = (select auth.uid())
    and exists (select 1 from cs_notes n where n.id = note_id)
  );
create policy cs_note_replies_update on cs_note_replies
  for update using ((select is_admin()) and author_id = (select auth.uid()))
  with check ((select is_admin()) and author_id = (select auth.uid()));

-- ===========================================================================
-- 3) Gatilhos espelhados
-- ===========================================================================

-- Auditoria da nota (BEFORE UPDATE): carimba updated_at/updated_by; congela a
-- identidade. Ramo do toggle de checkbox (GUC) preserva os carimbos (não vira
-- "editado") — mesma regra da 0101.
create or replace function cs_notes_audit()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.company_id := old.company_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if current_setting('app.task_checkbox', true) = '1' then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  else
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger trg_cs_notes_audit
  before update on cs_notes
  for each row execute function cs_notes_audit();

-- Auditoria da resposta (BEFORE UPDATE): marca edited_at quando corpo/anexos
-- mudam; ramo do toggle preserva.
create or replace function cs_note_replies_audit()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.note_id    := old.note_id;
  new.parent_id  := old.parent_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if current_setting('app.task_checkbox', true) = '1' then
    new.edited_at := old.edited_at;
  elsif new.body_html is distinct from old.body_html
     or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
create trigger trg_cs_note_replies_audit
  before update on cs_note_replies
  for each row execute function cs_note_replies_audit();

-- Integridade do encadeamento (espelha company_note_replies_check_parent).
create or replace function cs_note_replies_check_parent()
returns trigger language plpgsql set search_path to 'public' as $$
declare parent_note uuid; cursor_id uuid; hops int := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'Uma resposta nao pode responder a si mesma';
  end if;
  select note_id into parent_note from cs_note_replies where id = new.parent_id;
  if parent_note is null then raise exception 'Resposta-pai inexistente'; end if;
  if parent_note <> new.note_id then
    raise exception 'A resposta-pai pertence a outra atualizacao';
  end if;
  cursor_id := new.parent_id;
  while cursor_id is not null loop
    if cursor_id = new.id then raise exception 'Ciclo de respostas detectado'; end if;
    hops := hops + 1;
    if hops > 1000 then raise exception 'Cadeia de respostas longa demais'; end if;
    select parent_id into cursor_id from cs_note_replies where id = cursor_id;
  end loop;
  return new;
end;
$$;
create trigger trg_cs_note_replies_check_parent
  before insert or update on cs_note_replies
  for each row execute function cs_note_replies_check_parent();

-- Notificação de resposta (espelha notify_note_reply): avisa o AUTOR da nota,
-- SEM trecho do conteúdo, source_type 'cs_note_reply'. push_notification já
-- pula self e exige company_exists (seguro em cascata). O autor da nota é
-- sempre admin (RLS de insert).
create or replace function notify_cs_note_reply()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_company uuid;
begin
  select author_id, company_id into v_owner, v_company from cs_notes where id = new.note_id;
  perform push_notification(
    v_owner, 'resposta_recebida', 'Respondeu sua atualização do CS', null,
    v_company, 'cs_note_reply', new.id, new.author_id
  );
  return null;
end;
$$;
create trigger trg_notify_cs_note_reply
  after insert on cs_note_replies
  for each row execute function notify_cs_note_reply();

-- ===========================================================================
-- 4) Menções: content_mentions ganha os source_type do CS; as RPCs e a
--    notificação ganham o ramo CS (admin-only, sem trecho).
-- ===========================================================================
alter table content_mentions drop constraint content_mentions_source_type_check;
alter table content_mentions add constraint content_mentions_source_type_check
  check (source_type = any (array[
    'atualizacao','atualizacao_resposta','chamado','chamado_resposta',
    'cs_note','cs_note_reply'
  ]::text[]));

-- Sugestões de @ no CS: só admins (e só para quem é admin).
create or replace function public.mentionable_users(p_source_type text, p_company uuid)
returns table(id uuid, full_name text, avatar_path text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(auth.uid()) then return; end if;
    return query
      select p.id, p.full_name, p.avatar_path from profiles p
      where p.role in ('admin', 'consultor', 'colaborador') order by p.full_name;
  elsif p_source_type in ('atualizacao', 'atualizacao_resposta') then
    if not user_reaches_company(auth.uid(), p_company) then return; end if;
    return query
      select p.id, p.full_name, p.avatar_path from profiles p
      where p.role = 'admin'
         or exists (select 1 from company_consultants c
                    where c.company_id = p_company and c.consultant_id = p.id)
         or exists (select 1 from task_instances t
                    where t.company_id = p_company and t.collaborator_id = p.id)
      order by p.full_name;
  elsif p_source_type in ('cs_note', 'cs_note_reply') then
    if not is_admin() then return; end if;
    return query
      select p.id, p.full_name, p.avatar_path from profiles p
      where p.role = 'admin' order by p.full_name;
  end if;
end;
$function$;

-- Reconciliação das menções: ramo CS deriva a empresa das tabelas do CS, exige
-- caller admin e só valida menções a ADMINS.
create or replace function public.sync_content_mentions(p_source_type text, p_source_id uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_caller uuid := auth.uid(); v_company uuid; v_valid uuid[]; v_is_cs boolean := false;
begin
  if p_source_type = 'atualizacao' then
    select company_id into v_company from company_notes where id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'atualizacao_resposta' then
    select n.company_id into v_company from company_note_replies r
      join company_notes n on n.id = r.note_id where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'cs_note' then
    v_is_cs := true;
    select company_id into v_company from cs_notes where id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type = 'cs_note_reply' then
    v_is_cs := true;
    select n.company_id into v_company from cs_note_replies r
      join cs_notes n on n.id = r.note_id where r.id = p_source_id;
    if v_company is null then return; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    v_company := null;
  else
    raise exception 'source_type invalido: %', p_source_type;
  end if;

  -- Acesso do CALLER ao contexto.
  if v_is_cs then
    if not is_admin() then raise exception 'sem acesso ao contexto'; end if;
  elsif p_source_type in ('chamado', 'chamado_resposta') then
    if not is_internal_user(v_caller) then raise exception 'sem acesso ao contexto'; end if;
  else
    if not user_reaches_company(v_caller, v_company) then raise exception 'sem acesso ao contexto'; end if;
  end if;

  -- Menções VÁLIDAS: no CS, só admins; nos demais, como antes.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_valid
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where case
    when v_is_cs then (select role from profiles where id = u) = 'admin'
    when p_source_type in ('chamado', 'chamado_resposta') then is_internal_user(u)
    else user_reaches_company(u, v_company)
  end;

  delete from content_mentions
  where source_type = p_source_type and source_id = p_source_id
    and not (mentioned_user_id = any (v_valid));

  insert into content_mentions (mentioned_user_id, author_id, source_type, source_id, company_id)
  select u, v_caller, p_source_type, p_source_id, v_company
  from unnest(v_valid) as u
  on conflict (source_type, source_id, mentioned_user_id) do nothing;
end;
$function$;

-- Título da notificação de menção: ramo CS, sem trecho (body null já é a regra).
create or replace function public.notify_mention()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_title text;
begin
  v_title := case
    when new.source_type in ('chamado', 'chamado_resposta') then 'Mencionou você em um chamado'
    when new.source_type in ('cs_note', 'cs_note_reply') then 'Mencionou você numa atualização do CS'
    else 'Mencionou você em uma atualização'
  end;
  perform push_notification(
    new.mentioned_user_id, 'mencionado', v_title, null,
    new.company_id, new.source_type, new.source_id, new.author_id
  );
  return null;
end;
$function$;

-- ===========================================================================
-- 5) Checkbox na leitura (espelha 0101): GUC transação-local + trava otimista.
-- ===========================================================================
create or replace function public.toggle_cs_note_checkbox(p_id uuid, p_html text, p_token timestamptz)
returns timestamptz language plpgsql security invoker set search_path to 'public' as $$
declare v timestamptz;
begin
  perform set_config('app.task_checkbox', '1', true);
  update cs_notes set content_html = p_html
   where id = p_id and coalesce(updated_at, created_at) = p_token
  returning coalesce(updated_at, created_at) into v;
  return v;
end;
$$;

create or replace function public.toggle_cs_note_reply_checkbox(p_id uuid, p_html text, p_token timestamptz)
returns timestamptz language plpgsql security invoker set search_path to 'public' as $$
declare v timestamptz;
begin
  perform set_config('app.task_checkbox', '1', true);
  update cs_note_replies set body_html = p_html
   where id = p_id and coalesce(edited_at, created_at) = p_token
  returning coalesce(edited_at, created_at) into v;
  return v;
end;
$$;

grant execute on function public.toggle_cs_note_checkbox(uuid, text, timestamptz) to authenticated;
grant execute on function public.toggle_cs_note_reply_checkbox(uuid, text, timestamptz) to authenticated;

-- Contagem de respostas por nota do CS (espelha company_note_reply_counts).
-- SECURITY INVOKER: a RLS admin-only das tabelas é a barreira.
create or replace function public.cs_note_reply_counts(p_company uuid)
returns table(note_id uuid, reply_count bigint)
language sql stable security invoker set search_path to 'public' as $$
  select r.note_id, count(*)
  from cs_note_replies r join cs_notes n on n.id = r.note_id
  where n.company_id = p_company
  group by r.note_id;
$$;
grant execute on function public.cs_note_reply_counts(uuid) to authenticated;

-- ===========================================================================
-- 6) cs_board() ganha cs_note_count (contagem agregada). DROP + CREATE.
-- ===========================================================================
drop function if exists public.cs_board();

create function public.cs_board()
returns table (
  id uuid, name text, group_id uuid,
  started_on text, monthly_value text, project_value text, installments int,
  months_total int, period_days int,
  nps_status text, meeting_on text, responsibles jsonb,
  cs_note_count int
)
language plpgsql security invoker set search_path to 'public' as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o quadro de Sucesso do Cliente.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  with resp as (
    select company_id, consultant_id as user_id, true as is_cons, false as is_colab from company_consultants
    union all
    select company_id, collaborator_id as user_id, false, true from company_collaborators
  ),
  resp_roles as (
    select r.company_id, r.user_id, bool_or(r.is_cons) as is_cons, bool_or(r.is_colab) as is_colab
    from resp r group by r.company_id, r.user_id
  ),
  resp_json as (
    select rr.company_id,
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', coalesce(nullif(p.full_name, ''), p.email),
          'role', case when rr.is_cons and rr.is_colab then 'ambos'
                       when rr.is_cons then 'consultor' else 'colaborador' end,
          'status', pn.status
        )
        order by (case when rr.is_cons then 0 else 1 end), coalesce(nullif(p.full_name, ''), p.email)
      ) as items
    from resp_roles rr
    join profiles p on p.id = rr.user_id
    left join cs_person_nps pn on pn.company_id = rr.company_id and pn.user_id = rr.user_id
    group by rr.company_id
  ),
  notes as (
    select company_id, count(*)::int as n from cs_notes group by company_id
  )
  select
    c.id, c.name, c.group_id,
    to_char(d.started_on, 'YYYY-MM-DD'),
    case when v.project_value is not null and v.installments is not null and v.installments <> 0
         then round(v.project_value / v.installments, 2)::text else null end,
    v.project_value::text, v.installments,
    case when d.started_on is not null and d.ends_on is not null
         then (extract(year from age(d.ends_on, d.started_on)) * 12 + extract(month from age(d.ends_on, d.started_on)))::int
         else null end,
    case when d.started_on is not null and d.ends_on is not null
         then extract(day from age(d.ends_on, d.started_on))::int else null end,
    s.nps_status::text,
    to_char(s.meeting_on, 'YYYY-MM-DD'),
    coalesce(rj.items, '[]'::jsonb),
    coalesce(csn.n, 0)
  from companies c
  left join company_details d on d.company_id = c.id
  left join company_contract_values v on v.company_id = c.id
  left join cs_company_status s on s.company_id = c.id
  left join resp_json rj on rj.company_id = c.id
  left join notes csn on csn.company_id = c.id
  order by c.name;
end;
$fn$;

grant execute on function public.cs_board() to authenticated;

-- ===========================================================================
-- 7) Anexos do CS num bucket PRIVADO admin-only (os de Atualizações são buckets
--    PÚBLICOS; aqui o acesso é só admin — nem leitura nem URL para consultor).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('cs-note-files', 'cs-note-files', false)
on conflict (id) do nothing;

create policy cs_note_files_admin_all on storage.objects
  for all
  using (bucket_id = 'cs-note-files' and (select is_admin()))
  with check (bucket_id = 'cs-note-files' and (select is_admin()));
