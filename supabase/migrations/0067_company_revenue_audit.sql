-- =====================================================================
-- Faturamento — histórico de alterações (auditoria)
-- =====================================================================
-- company_revenues já guarda created_by/at e updated_by/at (a tela agora os
-- exibe). O que faltava é o HISTÓRICO: hoje uma correção SOBRESCREVE o valor e
-- o anterior se perde. Em dado financeiro é justamente a correção que precisa
-- ficar registrada — de quanto para quanto, por quem, quando.
--
-- MODELO APPEND-ONLY e IMUTÁVEL. Alimentado por TRIGGER em company_revenues (não
-- pelo código da aplicação): garante que QUALQUER caminho de gravação seja
-- registrado, inclusive correção feita direto no banco. Ninguém faz
-- insert/update/delete por policy — só o trigger escreve.
-- =====================================================================

create table company_revenue_audit (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  reference_month  date not null,
  channel          sales_channel not null,
  old_amount       numeric(14,2),      -- null no primeiro lançamento
  new_amount       numeric(14,2),      -- null quando o valor foi removido
  reason           text,               -- motivo curto opcional (só em alteração)
  changed_by       uuid references profiles(id),  -- null = feito direto no banco
  changed_at       timestamptz not null default now(),
  check (reason is null or char_length(reason) <= 280)
);

-- Histórico de UM mês de UMA empresa, do mais recente ao mais antigo.
create index idx_company_revenue_audit_lookup
  on company_revenue_audit (company_id, reference_month desc, changed_at desc);

-- ---------------------------------------------------------------------
-- Trigger de auditoria. SECURITY DEFINER de propósito: a tabela de auditoria
-- não tem policy de escrita nenhuma (só o trigger escreve), então a inserção
-- precisa correr como o dono da função (que ignora a RLS), não como o usuário.
--
-- Registra SÓ quando o valor muda de fato: um UPDATE que grava o mesmo amount
-- (ex.: re-salvar o mês sem tocar num canal) não gera linha.
--
-- O motivo vem de um GUC transaction-local (app.revenue_reason) que o
-- company_revenue_upsert define antes de gravar — assim o trigger o carimba sem
-- precisar de coluna em company_revenues. Só entra em ALTERAÇÃO (update/delete);
-- o primeiro lançamento (insert) nunca tem motivo.
--
-- changed_by = auth.uid() (lido do JWT, independente do SECURITY DEFINER). Numa
-- gravação feita direto no banco (sem JWT), fica null → "autor não registrado".
-- ---------------------------------------------------------------------
create or replace function company_revenues_audit_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    numeric(14,2);
  v_new    numeric(14,2);
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_old := null;
    v_new := new.amount;
    v_reason := null;  -- primeiro lançamento não pede motivo
  elsif tg_op = 'UPDATE' then
    if new.amount is not distinct from old.amount then
      return null;     -- valor não mudou de fato: não registra
    end if;
    v_old := old.amount;
    v_new := new.amount;
    v_reason := nullif(btrim(coalesce(current_setting('app.revenue_reason', true), '')), '');
  else -- DELETE
    v_old := old.amount;
    v_new := null;
    v_reason := nullif(btrim(coalesce(current_setting('app.revenue_reason', true), '')), '');
  end if;

  insert into company_revenue_audit
    (company_id, reference_month, channel, old_amount, new_amount, reason, changed_by)
  values (
    coalesce(new.company_id, old.company_id),
    coalesce(new.reference_month, old.reference_month),
    coalesce(new.channel, old.channel),
    v_old, v_new, v_reason, auth.uid()
  );
  return null;  -- AFTER trigger: valor de retorno ignorado
end;
$$;

create trigger trg_company_revenues_audit
  after insert or update or delete on company_revenues
  for each row execute function company_revenues_audit_trg();

-- ---------------------------------------------------------------------
-- RLS: leitura pelos MESMOS que já acessam o faturamento (admin todas,
-- consultor a própria carteira). Colaborador e anon NÃO leem. NENHUMA policy de
-- insert/update/delete — o registro é imutável e só o trigger escreve.
-- ---------------------------------------------------------------------
alter table company_revenue_audit enable row level security;

create policy cra_select on company_revenue_audit for select
  using (is_admin() or company_id in (select my_consultant_companies()));

-- ---------------------------------------------------------------------
-- company_revenue_upsert: agora recebe o MOTIVO (opcional) e o publica no GUC
-- transaction-local para o trigger de auditoria carimbar nas linhas alteradas.
-- Resto idêntico à 0062 (upsert por canal; vazio remove; observação à parte).
-- ---------------------------------------------------------------------
drop function if exists company_revenue_upsert(uuid, date, jsonb, text);

create or replace function company_revenue_upsert(
  p_company uuid,
  p_month   date,
  p_entries jsonb,
  p_note    text,
  p_reason  text default null
)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;  -- garante dia 1
  v_uid   uuid := auth.uid();
  e       jsonb;
  v_chan  sales_channel;
  v_raw   text;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- Motivo da alteração, para o trigger de auditoria (só afeta update/delete).
  perform set_config(
    'app.revenue_reason',
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), ''),
    true
  );

  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_chan := (e->>'channel')::sales_channel;
    v_raw  := e->>'amount';

    if v_raw is null or btrim(v_raw) = '' then
      delete from company_revenues
       where company_id = p_company
         and reference_month = v_month
         and channel = v_chan;
    else
      insert into company_revenues
        (company_id, reference_month, channel, amount, created_by)
      values
        (p_company, v_month, v_chan, v_raw::numeric, v_uid)
      on conflict (company_id, reference_month, channel)
      do update set amount = excluded.amount;  -- trigger carimba updated_*
    end if;
  end loop;

  if v_note is null then
    delete from company_revenue_notes
     where company_id = p_company and reference_month = v_month;
  else
    insert into company_revenue_notes
      (company_id, reference_month, note, updated_by)
    values
      (p_company, v_month, v_note, v_uid)
    on conflict (company_id, reference_month)
    do update set note = excluded.note;  -- trigger carimba updated_*
  end if;
end;
$$;

grant execute on function company_revenue_upsert(uuid, date, jsonb, text, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- Detalhe de UM mês: autoria (quem lançou / quem alterou por último) +
-- histórico de alterações. SECURITY INVOKER — escopo = RLS de company_revenues
-- e company_revenue_audit (admin tudo, consultor a carteira; qualquer outro
-- recebe vazio). Nomes são resolvidos no servidor (display_profiles).
--
-- createdBy/At = a linha de canal criada mais cedo no mês (o "lançamento").
-- updatedBy/At = a linha alterada mais recentemente (null se nunca editada).
-- audit        = uma linha por alteração, mais recente primeiro.
-- ---------------------------------------------------------------------
create or replace function company_revenue_month_detail(
  p_company uuid,
  p_month   date
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with v_month as (select date_trunc('month', p_month)::date as m),
  rows as (
    select * from company_revenues
     where company_id = p_company
       and reference_month = (select m from v_month)
  ),
  created as (
    select created_by, created_at from rows
     order by created_at asc nulls last, channel asc
     limit 1
  ),
  updated as (
    select updated_by, updated_at from rows
     where updated_at is not null
     order by updated_at desc
     limit 1
  ),
  audit as (
    select id, channel, old_amount, new_amount, reason, changed_by, changed_at
      from company_revenue_audit
     where company_id = p_company
       and reference_month = (select m from v_month)
     order by changed_at desc
  )
  select jsonb_build_object(
    'createdBy', (select created_by from created),
    'createdAt', (select created_at from created),
    'updatedBy', (select updated_by from updated),
    'updatedAt', (select updated_at from updated),
    'audit', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', a.id,
                  'channel', a.channel,
                  'oldAmount', a.old_amount,
                  'newAmount', a.new_amount,
                  'reason', a.reason,
                  'changedBy', a.changed_by,
                  'changedAt', a.changed_at
                ))
         from audit a),
      '[]'::jsonb
    )
  );
$$;

grant execute on function company_revenue_month_detail(uuid, date) to authenticated;
