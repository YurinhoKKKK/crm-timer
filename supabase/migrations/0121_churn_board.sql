-- =====================================================================
-- CONTROLE DE CHURN — ETAPA 2: A ABA (quadro + cálculos + edição + resumo)
-- =====================================================================
-- Etapa 1 (0120) CAPTUROU a foto do churn (company_churns). Aqui está a LEITURA e
-- a EDIÇÃO da 2ª aba do quadro Sucesso do Cliente:
--  · churn_rows()   — uma linha por registro ATIVO, com tudo JÁ CALCULADO no banco
--                     (meses contratados, meses permanecidos, receita perdida).
--                     Helper INTERNO reusado pelo quadro e pelo resumo (DRY).
--  · churn_board()  — formata churn_rows() para a aba (datas/valores como texto).
--  · churn_summary()— agrega churn_rows() para o resumo do topo (dinheiro SÓ no
--                     banco, nunca somado no JS).
--  · churn_set_*    — edição de data, motivo, vendedor e MRR (um UPDATE cada,
--                     recusando registro revertido). O MRR aqui é a FOTO do
--                     momento: NÃO toca company_contract_values.
--  · gatilho de auditoria em company_churns → cs_audit (fields churn_data,
--    churn_motivo, churn_vendedor, churn_mrr), mesmo padrão append-only da 0104/5.
--
-- PRINCÍPIOS (não reabrir):
--  · Só registros ATIVOS (reverted_at null). Revertidos ficam guardados, fora da aba.
--  · Grupo/cor da seção vêm de company_groups via churn_type — NUNCA por nome fixo.
--  · Tempo de Projeto reaproveita contract_duration() (company_details, ao vivo).
--  · Admin-only: todas as RPCs são SECURITY INVOKER (a RLS admin de company_churns
--    é a fronteira real) e começam recusando quem não é admin.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. churn_rows(p_start, p_end) — HELPER interno. Uma linha por registro ativo,
--    com os cálculos todos no banco. Filtro por churned_on no período; sem período
--    (p_start e p_end nulos = "Todos") inclui também os registros SEM data.
--
--    · months_contracted = meses completos de contract_duration(started_on, ends_on).
--    · months_stayed     = meses completos entre started_on e churned_on (age em
--                          meses, descartando dias; piso 0). Sem started_on ou sem
--                          churned_on -> null.
--    · lost              = SÓ cancelados calculáveis: greatest(contratado -
--                          permanecido, 0) * mrr, em numeric(14,2). Finalizados e
--                          cancelados sem algum dos três -> null.
-- ---------------------------------------------------------------------
create or replace function public.churn_rows(p_start date, p_end date)
returns table (
  id               uuid,
  company_id       uuid,
  company_name     text,
  churn_type       text,
  churned_on       date,
  reason           churn_reason,
  seller_name      text,
  consultants      jsonb,
  mrr              numeric,
  months_contracted integer,
  months_stayed    integer,
  lost             numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with raw as (
    select
      cc.id,
      cc.company_id,
      c.name as company_name,
      cc.churn_type,
      cc.churned_on,
      cc.reason,
      cc.seller_name,
      cc.consultants,
      cc.mrr,
      cd.months_total as months_contracted,
      d.started_on
    from company_churns cc
    join companies c on c.id = cc.company_id
    left join company_details d on d.company_id = cc.company_id
    left join lateral contract_duration(d.started_on, d.ends_on) cd on true
    where cc.reverted_at is null
      and (
        (p_start is null and p_end is null)
        or (cc.churned_on is not null
            and (p_start is null or cc.churned_on >= p_start)
            and (p_end   is null or cc.churned_on <= p_end))
      )
  ),
  base as (
    select
      r.*,
      case
        when r.started_on is not null and r.churned_on is not null
        then greatest(
               (extract(year  from age(r.churned_on, r.started_on)) * 12
              + extract(month from age(r.churned_on, r.started_on)))::int, 0)
        else null
      end as months_stayed
    from raw r
  )
  select
    b.id,
    b.company_id,
    b.company_name,
    b.churn_type,
    b.churned_on,
    b.reason,
    b.seller_name,
    b.consultants,
    b.mrr,
    b.months_contracted,
    b.months_stayed,
    case
      when b.churn_type = 'cancelado'
       and b.mrr is not null
       and b.months_contracted is not null
       and b.months_stayed is not null
      then (greatest(b.months_contracted - b.months_stayed, 0) * b.mrr)::numeric(14,2)
      else null
    end as lost
  from base b;
$fn$;

grant execute on function public.churn_rows(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. churn_board(p_start, p_end) — a aba. Formata churn_rows() para o front:
--    datas AAAA-MM-DD, enum/numeric como texto. Ordena por data mais recente
--    primeiro; sem data por último. O front separa Finalizados/Cancelados.
-- ---------------------------------------------------------------------
create or replace function public.churn_board(
  p_start date default null,
  p_end   date default null
)
returns table (
  id               uuid,
  company_id       uuid,
  company_name     text,
  churn_type       text,
  churned_on       text,
  reason           text,
  seller_name      text,
  consultants      jsonb,
  mrr              text,
  months_contracted integer,
  months_stayed    integer,
  lost_revenue     text
)
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id,
    r.company_id,
    r.company_name,
    r.churn_type,
    to_char(r.churned_on, 'YYYY-MM-DD'),
    r.reason::text,
    r.seller_name,
    r.consultants,
    r.mrr::text,
    r.months_contracted,
    r.months_stayed,
    r.lost::text
  from churn_rows(p_start, p_end) r
  order by r.churned_on desc nulls last, r.company_name;
end;
$fn$;

grant execute on function public.churn_board(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. churn_summary(p_start, p_end) — resumo do topo (conjunto filtrado, agregado
--    no banco). Dinheiro somado SÓ aqui (nunca no JS). Inclui as quebras por tipo,
--    por motivo (jsonb, inclusive 'nao_informado') e os avisos de completude.
-- ---------------------------------------------------------------------
create or replace function public.churn_summary(
  p_start date default null,
  p_end   date default null
)
returns table (
  total                   integer,
  cancelados              integer,
  finalizados             integer,
  mrr_total               text,
  mrr_cancelados          text,
  mrr_finalizados         text,
  lost_revenue_total      text,
  reasons                 jsonb,   -- {reason: count} incl. 'nao_informado'
  n_sem_mrr               integer,
  n_sem_periodo           integer, -- sem período de contrato (months_contracted null)
  n_motivo_nao_informado  integer,
  n_sem_data              integer
)
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores acessam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with r as (select * from churn_rows(p_start, p_end))
  select
    count(*)::int,
    count(*) filter (where churn_type = 'cancelado')::int,
    count(*) filter (where churn_type = 'finalizado')::int,
    coalesce(sum(mrr), 0)::numeric(14,2)::text,
    coalesce(sum(mrr) filter (where churn_type = 'cancelado'), 0)::numeric(14,2)::text,
    coalesce(sum(mrr) filter (where churn_type = 'finalizado'), 0)::numeric(14,2)::text,
    coalesce(sum(lost), 0)::numeric(14,2)::text,
    coalesce(
      (select jsonb_object_agg(reason::text, c)
         from (select reason, count(*)::int as c from r group by reason) q),
      '{}'::jsonb),
    count(*) filter (where mrr is null)::int,
    count(*) filter (where months_contracted is null)::int,
    count(*) filter (where reason = 'nao_informado')::int,
    count(*) filter (where churned_on is null)::int
  from r;
end;
$fn$;

grant execute on function public.churn_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. AUDITORIA dos campos editáveis (AFTER UPDATE, SECURITY DEFINER) → cs_audit.
--    Um registro por campo que MUDOU; nada quando o valor é o mesmo. A ENTRADA e a
--    REVERSÃO já são descritas pelo gatilho de captura da 0120 (field 'churn'); a
--    reversão só mexe em reverted_at/updated_*, então não gera linha aqui. Guard de
--    cascade reaproveita company_exists() (0079).
-- ---------------------------------------------------------------------
create or replace function company_churns_cs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not company_exists(new.company_id) then
    return null;
  end if;

  if new.churned_on is distinct from old.churned_on then
    insert into cs_audit (company_id, field, old_value, new_value, changed_by)
    values (new.company_id, 'churn_data',
            to_char(old.churned_on, 'YYYY-MM-DD'),
            to_char(new.churned_on, 'YYYY-MM-DD'), auth.uid());
  end if;

  if new.reason is distinct from old.reason then
    insert into cs_audit (company_id, field, old_value, new_value, changed_by)
    values (new.company_id, 'churn_motivo',
            old.reason::text, new.reason::text, auth.uid());
  end if;

  if new.seller_name is distinct from old.seller_name then
    insert into cs_audit (company_id, field, old_value, new_value, changed_by)
    values (new.company_id, 'churn_vendedor',
            old.seller_name, new.seller_name, auth.uid());
  end if;

  if new.mrr is distinct from old.mrr then
    insert into cs_audit (company_id, field, old_value, new_value, changed_by)
    values (new.company_id, 'churn_mrr',
            old.mrr::text, new.mrr::text, auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists trg_company_churns_cs_audit on company_churns;
create trigger trg_company_churns_cs_audit
  after update on company_churns
  for each row execute function company_churns_cs_audit();

-- ---------------------------------------------------------------------
-- 5. EDIÇÃO — RPCs SECURITY INVOKER, admin, UM UPDATE cada, recusando registro
--    revertido (where reverted_at is null; not found -> erro). A auditoria vem do
--    gatilho acima (nada quando o valor não muda).
-- ---------------------------------------------------------------------

-- Data do churn (null = limpar).
create or replace function public.churn_set_date(p_id uuid, p_date date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  update company_churns
     set churned_on = p_date, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  if not found then
    raise exception 'Registro de churn não encontrado ou já revertido.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Motivo: recusa 'nao_informado' e recusa QUALQUER mudança em finalizado (travado).
create or replace function public.churn_set_reason(p_id uuid, p_reason churn_reason)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type     text;
  v_reverted boolean;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason = 'nao_informado' then
    raise exception 'Escolha um motivo válido.' using errcode = 'check_violation';
  end if;

  select churn_type, (reverted_at is not null)
    into v_type, v_reverted
    from company_churns where id = p_id;
  if v_type is null then
    raise exception 'Registro de churn não encontrado.' using errcode = 'P0001';
  end if;
  if v_reverted then
    raise exception 'Registro de churn já revertido.' using errcode = 'P0001';
  end if;
  if v_type = 'finalizado' then
    raise exception 'Projetos finalizados têm o motivo travado.'
      using errcode = 'check_violation';
  end if;

  update company_churns
     set reason = p_reason, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
end;
$$;

-- Vendedor (texto da FOTO; até 200 caracteres; vazio = limpar).
create or replace function public.churn_set_seller(p_id uuid, p_text text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clean text;
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  v_clean := nullif(btrim(coalesce(p_text, '')), '');
  if v_clean is not null and length(v_clean) > 200 then
    raise exception 'O nome do vendedor deve ter no máximo 200 caracteres.'
      using errcode = 'check_violation';
  end if;
  update company_churns
     set seller_name = v_clean, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  if not found then
    raise exception 'Registro de churn não encontrado ou já revertido.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- MRR (foto do momento; texto decimal "digits.dd" do front, nunca float; vazio =
-- limpar). NUNCA altera company_contract_values — é a FOTO do churn.
create or replace function public.churn_set_mrr(p_id uuid, p_text text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clean text;
  v_mrr   numeric(14,2);
begin
  if not (select is_admin()) then
    raise exception 'Apenas administradores editam o Controle de Churn.'
      using errcode = 'insufficient_privilege';
  end if;
  v_clean := nullif(btrim(coalesce(p_text, '')), '');
  if v_clean is null then
    v_mrr := null;
  elsif v_clean !~ '^\d+(\.\d{1,2})?$' then
    raise exception 'Valor de MRR inválido.' using errcode = 'check_violation';
  else
    v_mrr := v_clean::numeric(14,2);
  end if;
  update company_churns
     set mrr = v_mrr, updated_at = now(), updated_by = auth.uid()
   where id = p_id and reverted_at is null;
  if not found then
    raise exception 'Registro de churn não encontrado ou já revertido.'
      using errcode = 'P0001';
  end if;
end;
$$;

grant execute on function public.churn_set_date(uuid, date)   to authenticated;
grant execute on function public.churn_set_reason(uuid, churn_reason) to authenticated;
grant execute on function public.churn_set_seller(uuid, text) to authenticated;
grant execute on function public.churn_set_mrr(uuid, text)    to authenticated;
