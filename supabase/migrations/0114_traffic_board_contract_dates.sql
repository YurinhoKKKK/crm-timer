-- 0114_traffic_board_contract_dates
--
-- Redesenho VISUAL do quadro de Tráfego: a coluna "Tempo de Contrato" passa a usar
-- a MESMA barra de período do quadro de Empresas (componente ContractBar), que
-- calcula a partir de início, fim e "hoje". O Gestor de Tráfego não lê
-- company_details (RLS), então essas datas precisam sair pela própria RPC
-- (DEFINER). Esta é a ÚNICA alteração de banco do redesenho: a traffic_board()
-- apenas EXPÕE na saída duas datas PURAS (started_on, ends_on) que ela JÁ lia de
-- company_details para calcular a duração. Nenhuma regra, RLS ou lógica muda.
--
-- DROP+CREATE porque o RETURNS TABLE ganha duas colunas (CREATE OR REPLACE não
-- permite mudar o tipo de retorno). Assinatura única (sem argumentos).

drop function if exists public.traffic_board();

create function public.traffic_board()
returns table(
  id uuid, name text, group_id uuid, synced boolean,
  months_total integer, period_days integer,
  started_on text, ends_on text,
  manual_group_id uuid, focus text, platform text, status text, budget text,
  history_count integer, traffic_note_count integer, labels jsonb, traffic_group_id uuid
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not ((select is_admin()) or (select auth_role()) = 'gestor_trafego') then
    raise exception 'Apenas administradores e o Gestor de Tráfego acessam o quadro de Tráfego.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with hist as (select company_id, count(*)::int as n from traffic_audit group by company_id),
  tnotes as (
    select n.company_id, count(*)::int as n from company_notes n
    join company_note_areas a on a.note_id = n.id and a.area = 'trafego' group by n.company_id
  ),
  lbl as (
    select cel.company_id,
      jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'bg_color', l.bg_color,
        'text_color', l.text_color, 'highlight', l.highlight) order by l.highlight desc, l.name) as items
    from company_effective_labels cel join labels l on l.id = cel.label_id group by cel.company_id
  )
  select
    c.id, c.name, c.group_id,
    exists (select 1 from company_contracted_channels x where x.company_id = c.id and x.channel in ('mercado_livre','shopee','amazon')) as synced,
    cd.months_total, cd.period_days,
    to_char(d.started_on, 'YYYY-MM-DD'), to_char(d.ends_on, 'YYYY-MM-DD'),
    ct.manual_group_id, ct.focus::text, ct.platform::text, ct.status::text,
    ct.budget::text, coalesce(h.n, 0), coalesce(tn.n, 0), coalesce(lbl.items, '[]'::jsonb),
    case
      when exists (select 1 from company_contracted_channels x where x.company_id = c.id and x.channel in ('mercado_livre','shopee','amazon'))
        then cg.traffic_group_id
      else coalesce(ct.manual_group_id, cg.traffic_group_id)
    end
  from companies c
  left join company_details d on d.company_id = c.id
  left join lateral contract_duration(d.started_on, d.ends_on) cd on true
  left join company_traffic ct on ct.company_id = c.id
  left join company_groups cg on cg.id = c.group_id
  left join hist h on h.company_id = c.id
  left join tnotes tn on tn.company_id = c.id
  left join lbl on lbl.company_id = c.id
  where exists (select 1 from company_contracted_channels cc where cc.company_id = c.id and cc.channel = 'trafego')
  order by c.name;
end;
$function$;
