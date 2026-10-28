-- =====================================================================
-- 0162 — Pontuação do Acompanhamento vira APROVEITAMENTO
-- =====================================================================
-- A Pontuação somava pontos por colaborador e favorecia quem tem mais clientes.
-- Passa a mostrar APROVEITAMENTO = pontos feitos ÷ chances (cliente-dias) × 100.
--
--   · Cliente-dia = uma linha FINALIZADA de followup_daily_scores atribuída ao
--     colaborador (dia útil em que a empresa estava avaliada e ele era
--     responsável). O dia corrente NÃO entra.
--   · Pontos continuam: verde +1, amarelo 0, vermelho −1 (inclui o semáforo).
--
-- DECISÕES (não reabrir):
--  1. Responsável CONGELADO: recompute/backfill/cascata NUNCA alteram
--     collaborator_id nem os créditos de linha FINALIZADA. Só o dia corrente e
--     dias ainda não finalizados usam os responsáveis atuais.
--  2. Mais de um colaborador → TODOS recebem o resultado do dia (1 cliente-dia
--     cada). followup_daily_credits(d, company_id, collaborator_id, points),
--     preenchida no recompute (congelada quando finaliza). followup_daily_scores
--     .collaborator_id fica por compatibilidade.
--  3. Ausências (collaborator_absences): dias úteis de ausência saem dos pontos
--     E das chances (filtradas na leitura, em tempo real — registrar em outubro
--     recalcula outubro). O quadro continua mostrando a cor real do cliente.
--  4. Empresa sem whatsapp_contact_id NÃO gera mais linha (nem cor nem ponto);
--     aparece em aviso no topo da Pontuação (followup_unlinked_companies).
--  5. Trocas de colaborador geram evento no histórico da empresa
--     (colaborador_adicionado / colaborador_removido).
--
-- Aditiva no essencial: NÃO recomputa dias passados (linhas finalizadas intactas);
-- só cria tabelas, faz backfill dos créditos a partir das linhas existentes e
-- recria funções. A mudança do whatsapp e o congelamento valem DAQUI PARA FRENTE.
--
-- ROLLBACK (completo):
--   drop trigger if exists trg_company_collaborators_event on company_collaborators;
--   drop function if exists company_collaborators_event_trg();
--   drop function if exists followup_unlinked_companies();
--   drop function if exists followup_scores_month(date, uuid, uuid, boolean);
--   -- (recriar a versão 0158 de followup_scores_month e followup_recompute_day)
--   drop table if exists collaborator_absences;
--   drop table if exists followup_daily_credits;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Créditos por colaborador/empresa/dia (a fonte do aproveitamento)
-- ---------------------------------------------------------------------
create table if not exists followup_daily_credits (
  d               date not null,
  company_id      uuid not null references companies(id) on delete cascade,
  collaborator_id uuid not null references profiles(id)  on delete cascade,
  points          integer not null default 0,
  primary key (d, company_id, collaborator_id)
);
create index if not exists followup_credits_collab_idx on followup_daily_credits(collaborator_id, d);
-- Acesso só via RPC DEFINER (igual a followup_daily_scores): RLS ligada, sem policy.
alter table followup_daily_credits enable row level security;

-- Backfill: uma linha por linha FINALIZADA existente, com o collaborator_id
-- gravado (quem pontuava). O dia corrente (não finalizado) não entra — seu
-- crédito é escrito quando o dia finalizar.
insert into followup_daily_credits (d, company_id, collaborator_id, points)
  select d, company_id, collaborator_id, points
    from followup_daily_scores
   where collaborator_id is not null
     and finalized = true
on conflict (d, company_id, collaborator_id) do nothing;

-- ---------------------------------------------------------------------
-- 2) Ausências do colaborador (sem motivo — LGPD)
-- ---------------------------------------------------------------------
create table if not exists collaborator_absences (
  id              uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references profiles(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists collaborator_absences_idx
  on collaborator_absences(collaborator_id, start_date, end_date);

alter table collaborator_absences enable row level security;
-- Só admin lê e escreve (a Pontuação lê via RPC DEFINER).
drop policy if exists ca_admin_all on collaborator_absences;
create policy ca_admin_all on collaborator_absences
  for all using ((select is_admin())) with check ((select is_admin()));

-- ---------------------------------------------------------------------
-- 3) followup_recompute_day: congela responsável/créditos de dia finalizado,
--    exclui empresa sem contato do Digisac, mantém os créditos.
-- ---------------------------------------------------------------------
create or replace function followup_recompute_day(p_day date)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_today      date    := (now() at time zone 'America/Sao_Paulo')::date;
  v_now_time   time    := (now() at time zone 'America/Sao_Paulo')::time;
  v_finalized  boolean := p_day < v_today;
  v_is_current boolean := p_day = v_today;
  v_vigencia   date    := date '2026-10-26';
  v_count      int     := 0;
begin
  if not followup_is_business_day(p_day) then
    delete from followup_daily_scores where d = p_day and not finalized;
    delete from followup_daily_credits where d = p_day
       and not exists (select 1 from followup_daily_scores s where s.d = p_day and s.company_id = followup_daily_credits.company_id and s.finalized);
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
     where c.whatsapp_contact_id is not null          -- decisão 4: sem contato, não gera linha
       and exists (select 1 from company_groups g
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
       set collaborator_id = case when followup_daily_scores.finalized
                                   then followup_daily_scores.collaborator_id   -- CONGELA em linha finalizada
                                   else excluded.collaborator_id end,
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

  -- Limpa linhas NÃO finalizadas de empresas que deixaram de ser avaliadas
  -- (grupo não-ativo, sem colaborador OU sem contato do Digisac). Em subconsultas
  -- inline — a CTE active_co não existe mais fora do statement anterior.
  delete from followup_daily_scores fds
   where fds.d = p_day
     and not fds.finalized
     and (
       not exists (select 1 from company_groups g
                    where g.id = followup_group_on_day(fds.company_id, p_day) and g.kind = 'active')
       or not exists (select 1 from company_collaborators cc where cc.company_id = fds.company_id)
       or not exists (select 1 from companies c where c.id = fds.company_id and c.whatsapp_contact_id is not null)
     );

  -- Créditos (a fonte do aproveitamento):
  if not v_finalized then
    -- Dia corrente: não conta no aproveitamento; mantém a tabela limpa.
    delete from followup_daily_credits where d = p_day;
  else
    -- Dia finalizado: CONGELA. Só escreve créditos de (d, empresa) que ainda não
    -- têm nenhum (1ª finalização ou backfill de dia inédito); 1 linha por
    -- colaborador atual da empresa, com os pontos do dia. Nunca reatribui/apaga.
    insert into followup_daily_credits (d, company_id, collaborator_id, points)
      select fds.d, fds.company_id, cc.collaborator_id, fds.points
        from followup_daily_scores fds
        join company_collaborators cc on cc.company_id = fds.company_id
       where fds.d = p_day
         and not exists (select 1 from followup_daily_credits x
                          where x.d = fds.d and x.company_id = fds.company_id)
    on conflict (d, company_id, collaborator_id) do nothing;
  end if;

  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------
-- 4) followup_scores_month: aproveitamento + cliente-dias (lê os créditos,
--    só finalizados, excluindo dias de ausência). Return MUDOU → DROP+CREATE.
-- ---------------------------------------------------------------------
drop function if exists followup_scores_month(date, uuid, uuid, boolean);
create function followup_scores_month(
  p_month date,
  p_consultant uuid default null,
  p_collaborator uuid default null,
  p_recovering boolean default false
)
returns table(
  collaborator_id uuid, collaborator_name text, avatar_path text,
  points int, client_days int, aproveitamento numeric,
  days_verde int, days_amarelo int, days_vermelho int, companies int
)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_current boolean := date_trunc('month', p_month) = date_trunc('month', v_today);
  v_relevant date;
begin
  if not is_admin() then
    raise exception 'followup_scores_month: acesso restrito a administradores.' using errcode = '42501';
  end if;
  if v_is_current then v_relevant := followup_relevant_day();
  else select max(gs::date) into v_relevant from generate_series(v_from, (v_to - 1), interval '1 day') gs
        where followup_is_business_day(gs::date); end if;

  return query
  with cr as (
    select fdc.collaborator_id, fdc.d, fdc.company_id, fdc.points, s.color
      from followup_daily_credits fdc
      join followup_daily_scores s
        on s.d = fdc.d and s.company_id = fdc.company_id and s.finalized = true
     where fdc.d >= v_from and fdc.d < v_to
       -- dia útil de ausência sai dos pontos E das chances
       and not exists (select 1 from collaborator_absences ab
                        where ab.collaborator_id = fdc.collaborator_id
                          and fdc.d between ab.start_date and ab.end_date)
       and (p_consultant is null or exists (
              select 1 from company_consultants cx
               where cx.company_id = fdc.company_id and cx.consultant_id = p_consultant))
       and (p_collaborator is null or fdc.collaborator_id = p_collaborator)
       and (not p_recovering or exists (
              select 1 from followup_daily_scores r
               where r.company_id = fdc.company_id and r.d = v_relevant and r.recovery_need > 0))
  )
  select cr.collaborator_id, dp.dp_name, dp.dp_avatar,
         sum(cr.points)::int,
         count(*)::int,
         round(sum(cr.points)::numeric / nullif(count(*), 0) * 100, 1),
         count(*) filter (where cr.color = 'verde')::int,
         count(*) filter (where cr.color = 'amarelo')::int,
         count(*) filter (where cr.color = 'vermelho')::int,
         count(distinct cr.company_id)::int
    from cr
    left join lateral (
      select d.name as dp_name, d.avatar_path as dp_avatar
        from display_profiles(array[cr.collaborator_id]::uuid[]) d
    ) dp on true
   group by cr.collaborator_id, dp.dp_name, dp.dp_avatar
   order by round(sum(cr.points)::numeric / nullif(count(*), 0) * 100, 1) desc nulls last;
end;
$function$;

revoke execute on function followup_scores_month(date, uuid, uuid, boolean) from public, anon;
grant  execute on function followup_scores_month(date, uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Empresas ativas com colaborador, mas SEM contato do Digisac (aviso).
-- ---------------------------------------------------------------------
create or replace function followup_unlinked_companies()
returns table(company_id uuid, company_name text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_admin() then
    raise exception 'followup_unlinked_companies: acesso restrito a administradores.' using errcode = '42501';
  end if;
  return query
  select c.id, c.name
    from companies c
   where (c.whatsapp_contact_id is null or btrim(c.whatsapp_contact_id) = '')
     and exists (select 1 from company_groups g
                  where g.id = followup_group_on_day(c.id, (now() at time zone 'America/Sao_Paulo')::date)
                    and g.kind = 'active')
     and exists (select 1 from company_collaborators cc where cc.company_id = c.id)
   order by c.name;
end;
$function$;

revoke execute on function followup_unlinked_companies() from public, anon;
grant  execute on function followup_unlinked_companies() to authenticated;

-- ---------------------------------------------------------------------
-- 6) Evento de histórico ao adicionar/remover colaborador (espelha consultor).
-- ---------------------------------------------------------------------
create or replace function company_collaborators_event_trg()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    v_name := display_name(new.collaborator_id);
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (new.company_id, 'colaborador_adicionado',
            'Colaborador ' || coalesce(v_name, '(desconhecido)') || ' adicionado',
            jsonb_build_object('collaboratorId', new.collaborator_id), auth.uid());
  else
    v_name := display_name(old.collaborator_id);
    insert into company_events (company_id, event_type, summary, details, actor_id)
    values (old.company_id, 'colaborador_removido',
            'Colaborador ' || coalesce(v_name, '(desconhecido)') || ' removido',
            jsonb_build_object('collaboratorId', old.collaborator_id), auth.uid());
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_company_collaborators_event on company_collaborators;
create trigger trg_company_collaborators_event
  after insert or delete on company_collaborators
  for each row execute function company_collaborators_event_trg();

-- Rótulos dos novos eventos no histórico (e no PDF).
create or replace function activity_type_label(p_type text)
returns text language sql immutable set search_path to 'public' as $function$
  select case p_type
    when 'atividade'                      then 'Atividade'
    when 'tarefa_criada'                  then 'Tarefa criada'
    when 'tarefa_concluida'               then 'Tarefa concluída'
    when 'tarefa_excluida'                then 'Tarefa excluída'
    when 'tarefa_recorrente_criada'       then 'Tarefa recorrente criada'
    when 'tarefa_recorrente_editada'      then 'Tarefa recorrente editada'
    when 'tarefa_recorrente_desativada'   then 'Tarefa recorrente desativada'
    when 'tarefas_pausadas_grupo'         then 'Tarefas pausadas (grupo)'
    when 'tarefas_retomadas_grupo'        then 'Tarefas retomadas (grupo)'
    when 'consultor_adicionado'           then 'Consultor adicionado'
    when 'consultor_removido'             then 'Consultor removido'
    when 'colaborador_adicionado'         then 'Colaborador adicionado'
    when 'colaborador_removido'           then 'Colaborador removido'
    when 'grupo_alterado'                 then 'Grupo alterado'
    when 'etiqueta_alterada'              then 'Etiqueta alterada'
    when 'faturamento_lancado'            then 'Faturamento lançado'
    when 'faturamento_corrigido'          then 'Faturamento corrigido'
    when 'informacoes_alteradas'          then 'Informações alteradas'
    when 'acesso_cliente_criado'          then 'Acesso do cliente criado'
    when 'acesso_cliente_senha_redefinida' then 'Senha do cliente redefinida'
    when 'acesso_cliente_revogado'        then 'Acesso do cliente revogado'
    when 'listagem_validada'              then 'Listagem validada'
    when 'reuniao_criada'                 then 'Reunião criada'
    when 'reuniao_cancelada'              then 'Reunião cancelada'
    else p_type
  end;
$function$;
