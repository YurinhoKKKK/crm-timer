-- =====================================================================
-- PORTAL DO CLIENTE — aba "Reuniões" (histórico + próximas)
--
-- O objetivo que originou toda a integração com o Google Calendar: o cliente
-- passa a ver, no portal, as reuniões da EMPRESA DELE — as próximas agendadas
-- e o histórico das já realizadas. Curadoria ESTRITA (só o que a função abaixo
-- seleciona): título, início/fim, tipo em linguagem do cliente e, SÓ nas
-- próximas online, o link do Meet. Nada de participantes, descrição, criador,
-- status de sincronização ou qualquer campo interno — eles não saem do banco.
--
-- BLINDAGEM (mesma arquitetura dos passos 25/30): a curadoria mora numa função
-- de payload SECURITY DEFINER que recebe a empresa JÁ RESOLVIDA; quem autoriza
-- é o chamador — a sessão do cliente (token + segredo) ou o cargo do usuário
-- logado (preview). O cliente nunca informa company_id: a empresa vem da SESSÃO.
--
-- Opt-out por exceção: meetings.client_hidden (default false = tudo aparece).
-- Só o CRIADOR e admin/consultor da empresa alteram — pela função abaixo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Coluna de opt-out
-- ---------------------------------------------------------------------
alter table meetings
  add column client_hidden boolean not null default false;

comment on column meetings.client_hidden is
  'true = reunião oculta do portal do cliente. Só criador/admin/consultor da empresa alteram, via set_meeting_client_hidden().';

-- ---------------------------------------------------------------------
-- 2. Toggle "ocultar/mostrar ao cliente"
-- ---------------------------------------------------------------------
-- A RLS de UPDATE em meetings é do CRIADOR (passo 1.1). Para que admin e o
-- consultor DA EMPRESA também possam alternar SÓ esta coluna (sem ganhar edição
-- do resto), a mudança passa por esta função SECURITY DEFINER, que autoriza por
-- dentro. Cliente (anon) nunca alcança — grant só a authenticated. Não usa
-- RETURNING (nada da armadilha da 0047).
create or replace function set_meeting_client_hidden(
  p_meeting uuid,
  p_hidden  boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_creator uuid;
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;

  select company_id, created_by into v_company, v_creator
    from meetings where id = p_meeting;
  if v_company is null then
    raise exception 'reunião inexistente';
  end if;

  if not (v_creator = auth.uid()
          or is_admin()
          or v_company in (select my_consultant_companies())) then
    raise exception
      'apenas o criador ou admin/consultor da empresa podem ocultar/mostrar ao cliente'
      using errcode = '42501';
  end if;

  update meetings
     set client_hidden = p_hidden,
         updated_at = now()
   where id = p_meeting;
end;
$$;

revoke execute on function set_meeting_client_hidden(uuid, boolean) from public, anon;
grant  execute on function set_meeting_client_hidden(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Curadoria compartilhada (fonte única do que o cliente vê)
-- ---------------------------------------------------------------------
-- Não autoriza nada: recebe a empresa já resolvida e monta o conteúdo curado.
-- Não é executável por anon/authenticated — só pelas funções de sessão/preview.
--
-- PRÓXIMAS: ends_at > now() (inclui a reunião EM ANDAMENTO), mais perto
-- primeiro; carrega o meet_link SÓ quando o tipo é 'meet'. ANTERIORES:
-- ends_at <= now(), mais recente primeiro, paginadas (o histórico cresce) e SEM
-- link (ruído, e o link provavelmente não vale mais).
create or replace function client_portal_meetings_payload(
  p_company uuid,
  p_limit   integer,
  p_offset  integer
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_limit      integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset     integer := greatest(coalesce(p_offset, 0), 0);
  v_past_total bigint;
  v_upcoming   jsonb;
  v_past       jsonb;
begin
  -- PRÓXIMAS (teto defensivo de 100; próximas raramente passam disso).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title', up.title,
             'starts_at', up.starts_at,
             'ends_at', up.ends_at,
             'type', up.meeting_type,
             'meet_link', case when up.meeting_type = 'meet'
                               then up.meet_link else null end
           ) order by up.starts_at asc, up.id
         ), '[]'::jsonb)
    into v_upcoming
    from (
      select m.id, m.title, m.starts_at, m.ends_at, m.meeting_type, m.meet_link
        from meetings m
       where m.company_id = p_company
         and not m.client_hidden
         and m.ends_at > now()
       order by m.starts_at asc, m.id
       limit 100
    ) up;

  -- Total das ANTERIORES (alimenta o "ver mais").
  select count(*) into v_past_total
    from meetings m
   where m.company_id = p_company
     and not m.client_hidden
     and m.ends_at <= now();

  -- Página das ANTERIORES (sem meet_link).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title', pg.title,
             'starts_at', pg.starts_at,
             'ends_at', pg.ends_at,
             'type', pg.meeting_type
           ) order by pg.starts_at desc, pg.id
         ), '[]'::jsonb)
    into v_past
    from (
      select m.id, m.title, m.starts_at, m.ends_at, m.meeting_type
        from meetings m
       where m.company_id = p_company
         and not m.client_hidden
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

revoke execute on function client_portal_meetings_payload(uuid, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Caminho do CLIENTE (anon, com sessão válida)
-- ---------------------------------------------------------------------
-- A empresa vem da SESSÃO (token + segredo em hash, não expirada). Sessão de
-- outra empresa / expirada / revogada => null. Trocar token/URL não retorna
-- reunião de outra empresa: o company_id nunca vem do navegador.
create or replace function client_portal_meetings(
  p_token   text,
  p_session text,
  p_limit   integer default 20,
  p_offset  integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company uuid := client_portal_session_company(p_token, p_session);
begin
  if v_company is null then
    return null;
  end if;
  return client_portal_meetings_payload(v_company, p_limit, p_offset);
end;
$$;

grant execute on function client_portal_meetings(text, text, integer, integer)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. "Ver como cliente" — pré-visualização autorizada por cargo
-- ---------------------------------------------------------------------
-- Mesma curadoria; autoriza pelo cargo (admin em todas; consultor só nas dele).
-- Sem token, sem sessão de portal.
create or replace function client_portal_preview_meetings(
  p_company uuid,
  p_limit   integer default 20,
  p_offset  integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not client_portal_can_preview(p_company) then
    raise exception 'sem permissão para pré-visualizar o portal desta empresa';
  end if;
  return client_portal_meetings_payload(p_company, p_limit, p_offset);
end;
$$;

revoke execute on function client_portal_preview_meetings(uuid, integer, integer)
  from public, anon;
grant  execute on function client_portal_preview_meetings(uuid, integer, integer)
  to authenticated;
