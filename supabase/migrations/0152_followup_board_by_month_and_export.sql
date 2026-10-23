-- =====================================================================
-- 0152 — /acompanhamento: quadro por MÊS + RPC de export da Pontuação
-- =====================================================================
-- (A) followup_board passa a receber o MÊS (p_month date) no lugar de
--     p_period_days. Troca a assinatura ⇒ DROP + CREATE (sem overload).
--       • Mês ATUAL: cor do DIA RELEVANTE (hoje, se útil; senão o último dia útil)
--         e contagem de dias por cor DENTRO do mês; empresas = grupo ativo agora.
--       • Mês PASSADO: sem "cor de hoje" — cor do ÚLTIMO dia útil daquele mês e
--         contagem do mês inteiro; empresas = as que tiveram pontuação em algum
--         dia útil do mês (⇒ estavam em Ativos/Ema naquele dia).
--       • "Última mensagem" = última válida ATÉ o fim do mês selecionado.
--     Ordem padrão: vermelho → amarelo → verde → aguardando; dentro da cor, há
--     mais tempo sem mensagem primeiro (a inversão é feita na tela).
-- (B) followup_scores_export(p_month date): grão empresa × dia útil para a
--     planilha (grupo NO DIA, responsável, 1ª mensagem, cor, pontos, finalizado).
--     Admin-only. Nunca expõe texto de mensagem (LGPD).
-- Convenção [[funcao-nova-revoke-anon]]: REVOKE public, anon em tudo que toco.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) Quadro por mês.
-- ---------------------------------------------------------------------
drop function if exists followup_board(int);
create function followup_board(p_month date)
returns table(
  company_id uuid, company_name text, consultants jsonb,
  relevant_day date, color text, is_today boolean,
  first_msg_at timestamptz, last_msg_at timestamptz, next_meeting_at timestamptz,
  days_verde int, days_amarelo int, days_vermelho int,
  responsible_id uuid, responsible_name text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month_start  date := date_trunc('month', p_month)::date;
  v_month_end    date := (date_trunc('month', p_month) + interval '1 month')::date; -- exclusivo
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
       and (case when v_is_current
              then exists (select 1 from company_groups g where g.id = c.group_id and g.kind = 'active')
              else c.id in (select distinct fds.company_id from followup_daily_scores fds
                             where fds.d >= v_month_start and fds.d < v_month_end)
            end)
  ),
  rel as (
    select distinct on (fds.company_id)
           fds.company_id, fds.color, fds.first_msg_at, fds.collaborator_id
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
  )
  select s.id, s.name, coalesce(cons.list, '[]'::jsonb),
         v_relevant,
         coalesce(rel.color, 'vermelho'),
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
-- (B) Grão empresa × dia útil do mês — fonte única da planilha de Pontuação.
-- ---------------------------------------------------------------------
create or replace function followup_scores_export(p_month date)
returns table(
  d date, company_id uuid, company_name text, group_name text,
  responsible_id uuid, responsible_name text,
  first_msg_at timestamptz, color text, points int, finalized boolean
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
         fds.first_msg_at, fds.color, fds.points, fds.finalized
    from followup_daily_scores fds
    join companies c on c.id = fds.company_id
    left join company_groups g on g.id = followup_group_on_day(fds.company_id, fds.d)
    left join lateral (
      select dpx.name from display_profiles(array[fds.collaborator_id]::uuid[]) dpx
    ) rp on fds.collaborator_id is not null
   where fds.d >= v_from and fds.d < v_to
   order by c.name, fds.d;
end;
$$;
revoke execute on function followup_scores_export(date) from public, anon;
grant  execute on function followup_scores_export(date) to authenticated;
