-- =====================================================================
-- 0157 — Pontuação do Acompanhamento: recuperação (semáforo ao contrário)
-- =====================================================================
-- Depois de um dia VERMELHO, o cliente se recupera: precisa de 2 dias verdes
-- para voltar ao normal. Separa o resultado do CONTATO do dia da COR DO CLIENTE.
--
--  (1) followup_daily_scores ganha:
--      · contact_color: resultado do contato do dia (regra antiga: 1ª msg <12h
--        verde; 12h-16:59 amarelo; >=17h/sem contato vermelho; dia corrente sem
--        contato antes das 17h = aguardando).
--      · recovery_need (0/1/2): dias verdes que ainda faltam depois do dia.
--      · color/points PASSAM A SER a cor do cliente e o ponto do colaborador pelo
--        semáforo abaixo (toda tela que já lê color/points reflete sozinha).
--
--  (2) Semáforo — estado anterior = recovery_need da última linha com d < dia:
--        need 0:  verde +1 need0 · amarelo 0 need0 · vermelho -1 need2
--        need 1:  verde +1 need0 · amarelo 0 need1 · vermelho -1 need2
--        need 2:  verde  0 (amarelo) need1 · amarelo 0 need2 · vermelho -1 need2
--      Dia corrente 'aguardando': color aguardando, 0, recovery_need = anterior.
--      Pontos seguem a cor do cliente: verde +1, vermelho -1, resto 0.
--
--  (3) Só dias úteis; fim de semana/feriado/pausa/sem linha são PULADOS e o
--      estado continua da última linha existente (sem expiração).
--
--  (4) Vigência 2026-10-26 (constante). Linhas anteriores NÃO mudam color/points;
--      ganham contact_color = color e recovery_need = 2 se vermelho, senão 0.
--
--  (5) D depende de D-1 ⇒ recompute processa em ordem crescente. Backfill de um
--      dia antigo recalcula em cascata até hoje (followup_backfill já é crescente).
--
-- Decisão 8: DROP+CREATE quando muda o retorno; REVOKE public,anon; gates atuais.
-- Rollback completo em supabase/rollback/0157_*.sql (remove colunas + volta funções).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas novas + backfill das linhas existentes (decisão 4) + índice do
--    "estado anterior" (busca a última linha da empresa com d < dia).
-- ---------------------------------------------------------------------
alter table followup_daily_scores
  add column if not exists contact_color text
    check (contact_color is null or contact_color in ('verde','amarelo','vermelho','aguardando')),
  add column if not exists recovery_need int not null default 0
    check (recovery_need in (0, 1, 2));

update followup_daily_scores
   set contact_color = color,
       recovery_need = case when color = 'vermelho' then 2 else 0 end
 where contact_color is null;

create index if not exists followup_scores_company_d_idx on followup_daily_scores(company_id, d);

-- ---------------------------------------------------------------------
-- 2) Recompute de um dia — agora com contact_color + semáforo de recuperação.
--    Base: 0156 (active_co exige colaborador). Lê o recovery_need da última linha
--    com d < p_day (pula fins de semana/feriados/dias sem linha, decisão 3). Para
--    d < VIGENCIA mantém o comportamento antigo (color = contato, pontos antigos).
-- ---------------------------------------------------------------------
create or replace function followup_recompute_day(p_day date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today      date      := (now() at time zone 'America/Sao_Paulo')::date;
  v_now_time   time      := (now() at time zone 'America/Sao_Paulo')::time;
  v_finalized  boolean   := p_day < v_today;
  v_is_current boolean   := p_day = v_today;
  v_vigencia   date      := date '2026-10-26';
  v_count      int       := 0;
begin
  if not followup_is_business_day(p_day) then
    delete from followup_daily_scores where d = p_day;
    return 0;
  end if;
  if p_day > v_today then return 0; end if;

  with
  day_bounds as (
    select (p_day::timestamp at time zone 'America/Sao_Paulo') as start_ts,
           ((p_day + 1)::timestamp at time zone 'America/Sao_Paulo') as end_ts
  ),
  active_co as (
    select c.id as company_id, c.whatsapp_contact_id
      from companies c
     where exists (select 1 from company_groups g
                    where g.id = followup_group_on_day(c.id, p_day) and g.kind = 'active')
       and exists (select 1 from company_collaborators cc where cc.company_id = c.id)
  ),
  valid as (
    select dm.contact_id, dm.digisac_user_id, dm.sent_at
      from digisac_messages dm, day_bounds b
     where dm.is_from_me and not dm.is_from_bot and not dm.is_comment
       and dm.sent_at >= b.start_ts - interval '60 seconds'
       and dm.sent_at <  b.end_ts   + interval '60 seconds'
  ),
  good as (
    select v.contact_id, v.sent_at
      from valid v
     where v.digisac_user_id is null
        or (select count(distinct v2.contact_id) from valid v2
             where v2.digisac_user_id = v.digisac_user_id
               and v2.sent_at > v.sent_at - interval '60 seconds'
               and v2.sent_at < v.sent_at + interval '60 seconds') < 5
  ),
  first_msg as (
    select ac.company_id, min(g.sent_at) as first_at
      from active_co ac
      join good g on g.contact_id = ac.whatsapp_contact_id
      join day_bounds b on true
     where g.sent_at >= b.start_ts and g.sent_at < b.end_ts
     group by ac.company_id
  ),
  -- Resultado do CONTATO do dia (regra antiga) + estado anterior (recovery_need
  -- da última linha com d < p_day; coalesce 0 = começa saudável).
  scored as (
    select ac.company_id,
           fm.first_at,
           case
             when fm.first_at is not null and (fm.first_at at time zone 'America/Sao_Paulo')::time < time '12:00:00' then 'verde'
             when fm.first_at is not null and (fm.first_at at time zone 'America/Sao_Paulo')::time < time '17:00:00' then 'amarelo'
             when fm.first_at is not null then 'vermelho'
             when v_is_current and v_now_time < time '17:00:00' and ac.whatsapp_contact_id is not null then 'aguardando'
             else 'vermelho'
           end as cc,
           coalesce((select fds2.recovery_need from followup_daily_scores fds2
                       where fds2.company_id = ac.company_id and fds2.d < p_day
                       order by fds2.d desc limit 1), 0) as prev_need
      from active_co ac
      left join first_msg fm on fm.company_id = ac.company_id
  ),
  -- Cor do cliente + recovery_need novo (decisão 2). Antes da vigência mantém a
  -- regra antiga (cliente = contato).
  final as (
    select s.company_id, s.first_at, s.cc,
           case
             when p_day < v_vigencia then s.cc
             when s.cc = 'vermelho'   then 'vermelho'
             when s.cc = 'aguardando' then 'aguardando'
             when s.cc = 'verde' and s.prev_need = 2 then 'amarelo'
             when s.cc = 'verde'      then 'verde'
             else 'amarelo'
           end as client_color,
           case
             when p_day < v_vigencia then (case when s.cc = 'vermelho' then 2 else 0 end)
             when s.cc = 'aguardando' then s.prev_need
             when s.cc = 'vermelho'   then 2
             when s.cc = 'verde' and s.prev_need = 2 then 1
             when s.cc = 'verde'      then 0
             else s.prev_need
           end as new_need
      from scored s
  ),
  upserted as (
    insert into followup_daily_scores
      (d, company_id, collaborator_id, first_msg_at, contact_color, color, points, recovery_need, finalized, computed_at)
    select p_day, f.company_id,
           (select cc.collaborator_id from company_collaborators cc
             where cc.company_id = f.company_id order by cc.collaborator_id limit 1),
           f.first_at, f.cc, f.client_color,
           case when f.client_color = 'verde' then 1
                when f.client_color = 'vermelho' then -1
                else 0 end,
           f.new_need, v_finalized, now()
      from final f
    on conflict (d, company_id) do update
       set collaborator_id = excluded.collaborator_id,
           first_msg_at    = excluded.first_msg_at,
           contact_color   = excluded.contact_color,
           color           = excluded.color,
           points          = excluded.points,
           recovery_need   = excluded.recovery_need,
           finalized       = excluded.finalized,
           computed_at     = excluded.computed_at
    returning 1
  )
  select count(*) into v_count from upserted;

  delete from followup_daily_scores fds
   where fds.d = p_day
     and not exists (
       select 1 from company_groups g
        where g.id = followup_group_on_day(fds.company_id, p_day) and g.kind = 'active'
     );

  return v_count;
end;
$$;
revoke execute on function followup_recompute_day(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Backfill único: recomputa da vigência até hoje sob a regra nova (cascata
--    em ordem crescente). Linhas anteriores ficam com o backfill do passo 1.
-- ---------------------------------------------------------------------
select followup_backfill(date '2026-10-26', (now() at time zone 'America/Sao_Paulo')::date);

-- ---------------------------------------------------------------------
-- 4) Quadro — devolve contact_color + recovery_need do dia relevante (tooltip).
--    Return muda ⇒ DROP + CREATE. Base: 0156.
-- ---------------------------------------------------------------------
drop function if exists followup_board(date);
create function followup_board(p_month date)
returns table(
  company_id uuid, company_name text, consultants jsonb, collaborators jsonb,
  relevant_day date, color text, contact_color text, recovery_need int, is_today boolean,
  first_msg_at timestamptz, last_msg_at timestamptz, next_meeting_at timestamptz,
  days_verde int, days_amarelo int, days_vermelho int,
  responsible_id uuid, responsible_name text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month_start  date := date_trunc('month', p_month)::date;
  v_month_end    date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_is_current   boolean := date_trunc('month', p_month) = date_trunc('month', v_today);
  v_month_end_ts timestamptz := ((date_trunc('month', p_month) + interval '1 month')::timestamp
                                 at time zone 'America/Sao_Paulo');
  v_relevant     date;
begin
  if v_is_current then
    v_relevant := followup_relevant_day();
  else
    select max(gs::date) into v_relevant
      from generate_series(v_month_start, (v_month_end - 1), interval '1 day') gs
     where followup_is_business_day(gs::date);
  end if;

  return query
  with scoped as (
    select c.id, c.name, c.whatsapp_contact_id
      from companies c
     where ((select is_admin()) or c.id in (select my_consultant_companies()))
       and exists (select 1 from company_collaborators cc where cc.company_id = c.id)
       and (case when v_is_current
              then exists (select 1 from company_groups g where g.id = c.group_id and g.kind = 'active')
              else c.id in (select distinct fds.company_id from followup_daily_scores fds
                             where fds.d >= v_month_start and fds.d < v_month_end)
            end)
  ),
  rel as (
    select distinct on (fds.company_id)
           fds.company_id, fds.color, fds.contact_color, fds.recovery_need,
           fds.first_msg_at, fds.collaborator_id
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d >= v_month_start and fds.d <= v_relevant
     order by fds.company_id, fds.d desc
  ),
  tally as (
    select fds.company_id,
           count(*) filter (where fds.color = 'verde')    as v,
           count(*) filter (where fds.color = 'amarelo')  as a,
           count(*) filter (where fds.color = 'vermelho') as r
      from followup_daily_scores fds
      join scoped s on s.id = fds.company_id
     where fds.d >= v_month_start and fds.d <= v_relevant
     group by fds.company_id
  ),
  lastmsg as (
    select s.id as company_id,
           (select max(dm.sent_at) from digisac_messages dm
             where dm.contact_id = s.whatsapp_contact_id
               and dm.is_from_me and not dm.is_from_bot and not dm.is_comment
               and dm.sent_at < v_month_end_ts) as at
      from scoped s where s.whatsapp_contact_id is not null
  ),
  nextmeet as (
    select m.company_id, min(m.starts_at) as at
      from meetings m join scoped s on s.id = m.company_id
     where m.starts_at > now() group by m.company_id
  ),
  cons as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.consultant_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_consultants cc join scoped s on s.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.consultant_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  ),
  colabs as (
    select cc.company_id,
           jsonb_agg(jsonb_build_object('id', cc.collaborator_id, 'name', d.name, 'avatar_path', d.avatar_path)
                     order by d.name) as list
      from company_collaborators cc join scoped s on s.id = cc.company_id
      left join lateral (
        select dp.name, dp.avatar_path
          from display_profiles(array[cc.collaborator_id]::uuid[]) dp
      ) d on true
     group by cc.company_id
  )
  select s.id, s.name,
         coalesce(cons.list, '[]'::jsonb), coalesce(colabs.list, '[]'::jsonb),
         v_relevant,
         coalesce(rel.color, 'vermelho'),
         coalesce(rel.contact_color, coalesce(rel.color, 'vermelho')),
         coalesce(rel.recovery_need, 0),
         (v_is_current and v_relevant = v_today and followup_is_business_day(v_today)),
         rel.first_msg_at, lastmsg.at,
         case when v_is_current then nextmeet.at else null end,
         coalesce(tally.v, 0)::int, coalesce(tally.a, 0)::int, coalesce(tally.r, 0)::int,
         rel.collaborator_id, resp.rname
    from scoped s
    left join rel      on rel.company_id = s.id
    left join tally    on tally.company_id = s.id
    left join lastmsg  on lastmsg.company_id = s.id
    left join nextmeet on nextmeet.company_id = s.id
    left join cons     on cons.company_id = s.id
    left join colabs   on colabs.company_id = s.id
    left join lateral (
      select rp.name as rname
        from display_profiles(array[rel.collaborator_id]::uuid[]) rp
    ) resp on rel.collaborator_id is not null
   order by
     case coalesce(rel.color, 'vermelho')
       when 'vermelho' then 0 when 'amarelo' then 1 when 'verde' then 2 else 3 end,
     lastmsg.at asc nulls first, s.name;
end;
$$;
revoke execute on function followup_board(date) from public, anon;
grant  execute on function followup_board(date) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Detalhe da Pontuação — + contact_color ("Contato do dia"). color = cor do
--    cliente. Return muda ⇒ DROP + CREATE. Base: 0156 (filtro sem-colab).
-- ---------------------------------------------------------------------
drop function if exists followup_scores_detail(uuid, date);
create function followup_scores_detail(p_collaborator uuid, p_month date)
returns table(
  company_id uuid, company_name text, d date,
  contact_color text, color text, recovery_need int, first_msg_at timestamptz, points int
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date;
        v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then
    raise exception 'followup_scores_detail: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  select fds.company_id, c.name, fds.d,
         coalesce(fds.contact_color, fds.color), fds.color, fds.recovery_need, fds.first_msg_at, fds.points
    from followup_daily_scores fds
    join companies c on c.id = fds.company_id
   where fds.d >= v_from and fds.d < v_to
     and fds.collaborator_id is not distinct from p_collaborator
     and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_detail(uuid, date) from public, anon;
grant  execute on function followup_scores_detail(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Export da Pontuação — + contact_color. color = cor do cliente. Return muda
--    ⇒ DROP + CREATE. Base: 0156 (3 args com filtros).
-- ---------------------------------------------------------------------
drop function if exists followup_scores_export(date, uuid, uuid);
create function followup_scores_export(
  p_month date, p_consultant uuid default null, p_collaborator uuid default null
)
returns table(
  d date, company_id uuid, company_name text, group_name text,
  responsible_id uuid, responsible_name text,
  first_msg_at timestamptz, contact_color text, color text, recovery_need int, points int, finalized boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date;
        v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then
    raise exception 'followup_scores_export: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  select fds.d, fds.company_id, c.name,
         coalesce(g.name, '(sem grupo)'),
         fds.collaborator_id, rp.name,
         fds.first_msg_at, coalesce(fds.contact_color, fds.color), fds.color, fds.recovery_need,
         fds.points, fds.finalized
    from followup_daily_scores fds
    join companies c on c.id = fds.company_id
    left join company_groups g on g.id = followup_group_on_day(fds.company_id, fds.d)
    left join lateral (
      select dpx.name from display_profiles(array[fds.collaborator_id]::uuid[]) dpx
    ) rp on fds.collaborator_id is not null
   where fds.d >= v_from and fds.d < v_to
     and exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
     and (p_consultant is null or exists (
            select 1 from company_consultants cx
             where cx.company_id = fds.company_id and cx.consultant_id = p_consultant))
     and (p_collaborator is null or exists (
            select 1 from company_collaborators ck
             where ck.company_id = fds.company_id and ck.collaborator_id = p_collaborator))
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_export(date, uuid, uuid) from public, anon;
grant  execute on function followup_scores_export(date, uuid, uuid) to authenticated;
