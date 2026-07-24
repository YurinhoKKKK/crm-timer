-- =====================================================================
-- Validação das listagens pelo cliente (APPEND-ONLY)
-- =====================================================================
-- Até aqui o cliente LIA (25-27) e CONVERSAVA (31). Agora ele registra um
-- VEREDITO — "o cliente aprovou esta listagem" é um registro de NEGÓCIO, que
-- pode ser invocado numa divergência futura. A integridade aqui é ainda mais
-- rígida que a das mensagens.
--
-- MODELO APPEND-ONLY: não há campo "status" que alguém sobrescreve. Cada ação
-- é um EVENTO imutável em listing_validations. O status atual de uma listagem é
-- DERIVADO do último evento; o histórico inteiro permanece. Mudar de ideia é um
-- NOVO evento — o anterior nunca some.
--
-- INTEGRIDADE DE AUTORIA (mesma regra das mensagens, sem exceção): author_type
-- e author_id NUNCA vêm do navegador. Portal -> função SECURITY DEFINER que
-- deriva a empresa da SESSÃO e carimba 'cliente'/NULL. Interno -> INSERT direto
-- sob policy que exige 'interno' E author_id = auth.uid(). Nenhuma policy aceita
-- 'cliente' vindo de usuário autenticado: ninguém de dentro forja um veredito do
-- cliente — nem admin.
--
-- SEM CONSEQUÊNCIA OPERACIONAL: só registra e notifica. Não trava a listagem,
-- não fecha tarefa, não muda estado interno, não dispara automação.
-- =====================================================================

create table listing_validations (
  id                uuid primary key default uuid_generate_v4(),
  -- O item validado é uma combinação marca × marketplace (listing_results).
  listing_result_id uuid not null references listing_results(id) on delete cascade,
  -- Empresa carimbada no servidor (nunca do navegador); facilita RLS e as filas.
  company_id        uuid not null references companies(id) on delete cascade,
  event_type        text not null
                      check (event_type in ('aprovado', 'ajuste_solicitado', 'contestado')),
  comment           text,
  author_type       text not null check (author_type in ('cliente', 'interno')),
  -- Quem registrou, do lado interno. NULL para o cliente (não tem conta).
  author_id         uuid references profiles(id),
  created_at        timestamptz not null default now(),

  -- Proveniência dos eventos do CLIENTE (nunca preenchida no lado interno).
  client_session_id uuid,
  client_ip_hash    text,
  client_user_agent text,

  -- A forma da linha reflete o caminho que a criou.
  constraint lv_author_shape check (
    (author_type = 'interno' and author_id is not null
       and client_session_id is null and client_ip_hash is null)
    or
    (author_type = 'cliente' and author_id is null)
  ),
  -- Comentário: sempre limitado; obrigatório para ajuste/contestação (senão a
  -- equipe recebe um "não gostei" sem saber o quê). Aprovação pode não ter.
  constraint lv_comment_len check (
    comment is null or char_length(btrim(comment)) between 1 and 2000
  ),
  constraint lv_comment_required check (
    event_type = 'aprovado'
    or (comment is not null and btrim(comment) <> '')
  )
);

create index idx_lv_result on listing_validations(listing_result_id, created_at desc);
create index idx_lv_company on listing_validations(company_id, created_at desc);

alter table listing_validations enable row level security;

-- LEITURA/NOTIFICAÇÃO: admin (todas), consultor (empresas dele) e o COLABORADOR
-- RESPONSÁVEL pela listagem (task_instances.collaborator_id da tarefa que gerou
-- aquele item). Diferente das mensagens (passo 32), o colaborador NÃO vê tudo da
-- empresa: só as validações das listagens que são responsabilidade DELE — o
-- vínculo aqui é direto e específico, não derivado. Isso também define quem é
-- notificado (a fila e o badge são SECURITY INVOKER: herdam esta policy).
create policy lv_select on listing_validations for select
  using (
    is_admin()
    or company_id in (select my_consultant_companies())
    or listing_result_id in (
      select lr.id
        from listing_results lr
        join task_instances ti on ti.id = lr.task_id
       where ti.collaborator_id = auth.uid()
    )
  );

-- ESCRITA INTERNA: só como 'interno' e em nome de si mesmo, e só onde já tem
-- acesso. Esta policy é a garantia de que ninguém de dentro forja um veredito de
-- cliente — não há WITH CHECK que aceite author_type='cliente'. (Não há UI
-- interna de escrita por ora; a policy existe para o modelo ficar completo e
-- para um eventual "cliente aprovou por telefone", sempre marcado como interno.)
create policy lv_insert_interno on listing_validations for insert
  with check (
    author_type = 'interno'
    and author_id = auth.uid()
    and (
      is_admin()
      or company_id in (select my_consultant_companies())
      or listing_result_id in (
        select lr.id
          from listing_results lr
          join task_instances ti on ti.id = lr.task_id
         where ti.collaborator_id = auth.uid()
      )
    )
  );

-- Sem policy de UPDATE e sem policy de DELETE: eventos são IMUTÁVEIS para todos,
-- inclusive admin. Mudar de ideia é um novo evento.

-- ---------------------------------------------------------------------
-- Marcação de "visto" das validações, POR USUÁRIO (como nas mensagens).
-- Alimenta a parte de validações do badge; a FILA (o que precisa refazer)
-- independe disso e mostra o que está em aberto.
-- ---------------------------------------------------------------------
create table listing_validation_reads (
  user_id      uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id)
);

alter table listing_validation_reads enable row level security;

create policy lvr_rw on listing_validation_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Portal: registrar uma validação (anon, com sessão válida)
-- ---------------------------------------------------------------------
-- Empresa e autoria vêm DA SESSÃO, nunca do payload. Valida que o item pertence
-- à empresa da sessão e que o evento faz sentido para o estado do item (listada
-- x não listada). Rate limit no mesmo espírito das mensagens.
create or replace function client_portal_listing_validate(
  p_token           text,
  p_session         text,
  p_listing_result  uuid,
  p_event_type      text,
  p_comment         text default null,
  p_ip              text default null,
  p_user_agent      text default null
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company    uuid := client_portal_session_company(p_token, p_session);
  v_session_id uuid;
  v_has_link   boolean;
  v_comment    text := nullif(btrim(coalesce(p_comment, '')), '');
  v_recent     integer;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'error', 'sessao');
  end if;

  -- O item tem de ser desta empresa. Também descobrimos se é listada (com link).
  select (lr.link is not null) into v_has_link
    from listing_results lr
    join task_instances ti on ti.id = lr.task_id
   where lr.id = p_listing_result and ti.company_id = v_company;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'item');
  end if;

  -- Evento coerente com o estado do item (o cliente aprova/pede ajuste no que
  -- está listado; contesta o que não foi listado).
  if p_event_type in ('aprovado', 'ajuste_solicitado') and not v_has_link then
    return jsonb_build_object('ok', false, 'error', 'estado');
  elsif p_event_type = 'contestado' and v_has_link then
    return jsonb_build_object('ok', false, 'error', 'estado');
  elsif p_event_type not in ('aprovado', 'ajuste_solicitado', 'contestado') then
    return jsonb_build_object('ok', false, 'error', 'tipo');
  end if;

  -- Comentário obrigatório para ajuste/contestação.
  if p_event_type in ('ajuste_solicitado', 'contestado') and v_comment is null then
    return jsonb_build_object('ok', false, 'error', 'comentario');
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'longo');
  end if;

  -- Rate limit: no máximo 20 validações por empresa a cada 10 minutos.
  select count(*) into v_recent
    from listing_validations
   where company_id = v_company
     and author_type = 'cliente'
     and created_at > now() - interval '10 minutes';
  if v_recent >= 20 then
    return jsonb_build_object('ok', false, 'error', 'limite');
  end if;

  select s.id into v_session_id
    from client_portal_sessions s
   where s.company_id = v_company
     and s.secret_hash = encode(digest(p_session, 'sha256'), 'hex');

  insert into listing_validations
    (listing_result_id, company_id, event_type, comment, author_type, author_id,
     client_session_id, client_ip_hash, client_user_agent)
  values
    (p_listing_result, v_company, p_event_type, v_comment,
     'cliente', null,
     v_session_id,
     case when p_ip is null then null
          else encode(digest(p_ip, 'sha256'), 'hex') end,
     left(coalesce(p_user_agent, ''), 400));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function
  client_portal_listing_validate(text, text, uuid, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Notificações — reaproveitam a caixa de entrada/badge do passo 32.
-- SÓ 'ajuste_solicitado' e 'contestado' notificam (aprovação não vira ruído).
-- Todas SECURITY INVOKER: o escopo é o RLS lv_select, ou seja, os destinatários
-- são exatamente admin + consultores da empresa + colaborador responsável.
-- ---------------------------------------------------------------------

-- Quantas validações acionáveis (ajuste/contestação do CLIENTE), ainda no estado
-- atual do item, este usuário ainda não "viu".
create or replace function my_unread_validations()
returns bigint
language sql stable security invoker set search_path = public
as $$
  select count(*)
    from listing_validations v
   where v.event_type in ('ajuste_solicitado', 'contestado')
     and v.author_type = 'cliente'
     and v.created_at > coalesce(
           (select last_read_at from listing_validation_reads where user_id = auth.uid()),
           '-infinity'::timestamptz)
     and not exists (
       select 1 from listing_validations v2
        where v2.listing_result_id = v.listing_result_id
          and v2.created_at > v.created_at
     );
$$;

revoke execute on function my_unread_validations() from public, anon;
grant execute on function my_unread_validations() to authenticated;

-- Badge da sidebar = mensagens não lidas + validações acionáveis não vistas.
-- FONTE ÚNICA: uma função só, somando as duas contagens já existentes — nada de
-- segundo sistema de badge paralelo.
create or replace function my_unread_total()
returns bigint
language sql stable security invoker set search_path = public
as $$
  select my_unread_messages() + my_unread_validations();
$$;

revoke execute on function my_unread_total() from public, anon;
grant execute on function my_unread_total() to authenticated;

-- Marca todas as validações como vistas por este usuário (o badge zera a parte
-- de validações; a FILA de itens em aberto continua aparecendo).
create or replace function mark_validations_read()
returns void
language sql security invoker set search_path = public
as $$
  insert into listing_validation_reads (user_id, last_read_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_read_at = now();
$$;

revoke execute on function mark_validations_read() from public, anon;
grant execute on function mark_validations_read() to authenticated;

-- Fila interna: listagens com ajuste solicitado ou contestação EM ABERTO (o
-- estado atual do item é o evento do cliente). Escopada por cargo via lv_select
-- + as RLS de listing_results/task_instances/companies (SECURITY INVOKER):
-- admin todas; consultor as dele; COLABORADOR só as listagens dele.
create or replace function listing_validation_queue()
returns table (
  company_id        uuid,
  company_name      text,
  listing_result_id uuid,
  task_id           uuid,
  brand             text,
  marketplace       listing_marketplace,
  link              text,
  event_type        text,
  comment           text,
  at                timestamptz
)
language sql stable security invoker set search_path = public
as $$
  with latest as (
    select distinct on (v.listing_result_id)
           v.listing_result_id, v.event_type, v.comment, v.author_type, v.created_at
      from listing_validations v
     order by v.listing_result_id, v.created_at desc
  )
  select ti.company_id, c.name, lr.id, lr.task_id, lb.name, lr.marketplace, lr.link,
         latest.event_type, latest.comment, latest.created_at
    from latest
    join listing_results lr on lr.id = latest.listing_result_id
    join listing_brands  lb on lb.id = lr.brand_id
    join task_instances  ti on ti.id = lr.task_id
    join companies       c  on c.id  = ti.company_id
   where latest.event_type in ('ajuste_solicitado', 'contestado')
     and latest.author_type = 'cliente'
   order by latest.created_at desc;
$$;

revoke execute on function listing_validation_queue() from public, anon;
grant execute on function listing_validation_queue() to authenticated;

-- Histórico completo de validação de UMA listagem (para a central da empresa):
-- todos os eventos em ordem, com o primeiro nome de quem registrou (equipe) via
-- display_profiles — sem esbarrar no RLS de profiles. SECURITY INVOKER: só
-- devolve algo se o usuário já pode ler aquelas validações (lv_select).
create or replace function listing_validation_history(p_listing_result uuid)
returns table (
  id          uuid,
  event_type  text,
  comment     text,
  author_type text,
  author      text,
  at          timestamptz
)
language sql stable security invoker set search_path = public
as $$
  select v.id, v.event_type, v.comment, v.author_type,
         case when v.author_type = 'interno'
              then split_part(coalesce(dp.name, 'Equipe'), ' ', 1)
              else null end as author,
         v.created_at
    from listing_validations v
    left join lateral (
      select name from display_profiles(array[v.author_id]::uuid[])
    ) dp on true
   where v.listing_result_id = p_listing_result
   order by v.created_at;
$$;

revoke execute on function listing_validation_history(uuid) from public, anon;
grant execute on function listing_validation_history(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Portal: o payload curado passa a trazer, por listagem, o ID do item (para o
-- cliente referenciar ao validar) e o ESTADO ATUAL da validação (derivado do
-- último evento). Sem novos dados operacionais — só o veredito do próprio
-- cliente. Usado pelos DOIS caminhos (sessão do cliente e "Ver como cliente").
-- ---------------------------------------------------------------------
create or replace function client_portal_payload(p_company uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  return jsonb_build_object(
    'company_name', (select name from companies where id = p_company),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', lr.id,
               'brand', lb.name,
               'marketplace', lr.marketplace,
               'link', lr.link,
               'reason', lr.not_done_reason,
               'date', coalesce(ti.finished_at, ti.task_date::timestamptz),
               'validation', (
                 select jsonb_build_object(
                          'event', v.event_type,
                          'comment', v.comment,
                          'by', v.author_type,
                          'at', v.created_at)
                   from listing_validations v
                  where v.listing_result_id = lr.id
                  order by v.created_at desc
                  limit 1
               )
             ) order by coalesce(ti.finished_at, ti.task_date::timestamptz) desc,
                        lb.name)
        from listing_results lr
        join listing_brands lb on lb.id = lr.brand_id
        join task_instances ti on ti.id = lr.task_id
       where ti.company_id = p_company
    ), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'html', n.content_html,
               'at', n.created_at
             ) order by n.created_at desc)
        from company_notes n
       where n.company_id = p_company
         and n.visible_to_client
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function client_portal_payload(uuid) from public, anon, authenticated;

-- Realtime para o badge/fila (como as mensagens no passo 31.1). A entrega passa
-- pela RLS lv_select por assinante — o cliente de outra empresa não recebe.
alter publication supabase_realtime add table listing_validations;
