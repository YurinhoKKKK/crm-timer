-- =====================================================================
-- 0170_responsible_timeline_null_start :: CRM/Timer - Monvatti
-- =====================================================================
-- Fecha a reconstrução (0169) do lado da EXIBIÇÃO. A 0169 passou a gravar
-- consultores atuais sem evento de adição com start_date NULL ("início não
-- registrado"). A RPC company_responsible_timeline (0168) devolvia um array
-- cru e a UI caía em "hoje" para start null (fmtDate(null)).
--
-- Mudanças:
--  · responsible_tracking_since() (DEFINER): data GLOBAL do 1º evento
--    consultor_adicionado/removido do sistema. Vira o "antes de DD/MM/AAAA"
--    da decisão 1 — global (não depende do alcance de quem consulta, senão
--    cada usuário veria uma data diferente). Só devolve um escalar de data,
--    sem vazar linhas. Convenção [[funcao-nova-revoke-anon]]: revoke public/anon.
--  · company_responsible_timeline recriada: agora devolve um OBJETO
--    { refDate, periods:[...] }. Cada período ganha `startApprox` = true quando
--    é o período reconstruído MAIS ANTIGO de um COLABORADOR (decisão 4:
--    "desde pelo menos DD/MM" — início dos DADOS, não a entrada real).
--    Mantém INVOKER (RLS de company_responsible_periods / company_events
--    continua valendo para quem chama). start_date null ordena primeiro.
--
-- Rollback: supabase/rollback/0170_responsible_timeline_null_start.sql
-- =====================================================================

-- Data global do início do registro de troca de responsável (1º evento
-- consultor_* do sistema). DEFINER só para a data não depender do alcance.
create or replace function public.responsible_tracking_since()
returns date
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select min((created_at at time zone 'America/Sao_Paulo')::date)
  from company_events
  where event_type in ('consultor_adicionado', 'consultor_removido');
$$;

revoke all on function public.responsible_tracking_since() from public, anon;
grant execute on function public.responsible_tracking_since() to authenticated;

-- Linha do tempo de responsáveis: { refDate, periods[] }.
create or replace function public.company_responsible_timeline(p_company uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions'
as $$
  with per as (
    select rp.id, rp.person_id, rp.role, rp.start_date, rp.end_date, rp.source,
      (rp.source = 'reconstruido'
        and rp.role = 'colaborador'
        and rp.start_date is not null
        and rp.start_date = min(rp.start_date)
            filter (where rp.source = 'reconstruido' and rp.start_date is not null)
            over (partition by rp.role)) as start_approx
    from company_responsible_periods rp
    where rp.company_id = p_company
  )
  select jsonb_build_object(
    'refDate', public.responsible_tracking_since(),
    'periods', coalesce(
      jsonb_agg(jsonb_build_object(
        'id', per.id, 'personId', per.person_id, 'role', per.role,
        'name', coalesce(dp.name, '(desconhecido)'), 'avatar', dp.avatar_path,
        'startDate', per.start_date, 'endDate', per.end_date, 'source', per.source,
        'startApprox', coalesce(per.start_approx, false)
      ) order by per.role, per.start_date desc nulls first, per.end_date desc nulls first),
      '[]'::jsonb)
  )
  from per
  left join lateral (
    select name, avatar_path from display_profiles(array[per.person_id])
  ) dp on true;
$$;

revoke all on function public.company_responsible_timeline(uuid) from public, anon;
grant execute on function public.company_responsible_timeline(uuid) to authenticated;
