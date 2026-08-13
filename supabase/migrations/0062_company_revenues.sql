-- =====================================================================
-- Faturamento mensal por canal de venda (Fatia 1)
-- =====================================================================
-- Acompanhamento do faturamento dos clientes em cada canal onde vendem, mês a
-- mês, para ver a progressão por canal. Valores digitados manualmente pela
-- equipe. DADO COMERCIAL SENSÍVEL.
--
-- QUEM VÊ E EDITA: admin (todas as empresas) OU consultor VINCULADO àquela
-- empresa (company_consultants, via my_consultant_companies()). O COLABORADOR
-- NÃO passa em nenhuma policy — de propósito NÃO reaproveitamos
-- my_collaborator_companies() (o vínculo derivado das mensagens/anotações): o
-- cliente nunca vê faturamento, e o colaborador também não. anon NUNCA.
--
-- FATURAMENTO BRUTO, antes de taxas e comissões (a tela reforça isso em texto).
--
-- DINHEIRO é numeric(14,2), NUNCA float — soma de dinheiro em ponto flutuante
-- acumularia erro de centavo e apareceria no total do projeto.
--
-- reference_month é DATE fixada no dia 1 (check), tratada como data PURA: nunca
-- convertida para timestamp nem sujeita a fuso (o risco seria o mês virar o
-- anterior por UTC×BRT).
--
-- Mês SEM lançamento é "sem registro", NUNCA zero. Só zero DIGITADO vale zero
-- (a distinção mora na presença/ausência da linha).
-- =====================================================================

-- Canais de venda suportados (ordem de declaração = ordem de exibição).
create type sales_channel as enum (
  'mercado_livre',
  'shopee',
  'amazon',
  'site_proprio'
);

-- ---------------------------------------------------------------------
-- Quais canais a empresa usa (alterável a qualquer momento).
--
-- ATENÇÃO: desativar um canal é SÓ um filtro do formulário de lançamento.
-- NUNCA apaga nem esconde faturamento já lançado naquele canal. Se a empresa
-- saiu da Shopee, o histórico da Shopee continua em company_revenues e nos
-- totais. Por isso NÃO há cascade nem trigger removendo faturamento ao
-- desativar canal — só o boolean `active` muda.
-- ---------------------------------------------------------------------
create table company_sales_channels (
  company_id  uuid not null references companies(id) on delete cascade,
  channel     sales_channel not null,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id),
  primary key (company_id, channel)
);

-- ---------------------------------------------------------------------
-- Uma linha por (empresa, mês, canal). Nada de coluna por canal.
-- ---------------------------------------------------------------------
create table company_revenues (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  reference_month  date not null,
  channel          sales_channel not null,
  amount           numeric(14,2) not null check (amount >= 0),
  created_at       timestamptz not null default now(),
  created_by       uuid references profiles(id),
  updated_at       timestamptz,
  updated_by       uuid references profiles(id),
  unique (company_id, reference_month, channel),
  -- data PURA no dia 1 do mês (mês de referência, não um instante).
  check (extract(day from reference_month) = 1)
);

-- Listagem da tela: os meses de UMA empresa, do mais recente ao mais antigo.
create index idx_company_revenues_company
  on company_revenues (company_id, reference_month desc);

-- ---------------------------------------------------------------------
-- Observação do MÊS (não por canal). Texto simples, curto, opcional.
-- ---------------------------------------------------------------------
create table company_revenue_notes (
  company_id       uuid not null references companies(id) on delete cascade,
  reference_month  date not null,
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references profiles(id),
  primary key (company_id, reference_month),
  check (extract(day from reference_month) = 1),
  check (note is null or char_length(note) <= 280)
);

-- ---------------------------------------------------------------------
-- Triggers: congelam a identidade da linha e carimbam updated_at/updated_by
-- (mesma filosofia de company_notes_audit / meetings). Numa EDIÇÃO, ninguém
-- reescreve empresa/mês/canal/criação por baixo.
-- ---------------------------------------------------------------------
create or replace function company_revenues_touch()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.company_id      := old.company_id;
  new.reference_month := old.reference_month;
  new.channel         := old.channel;
  new.created_at      := old.created_at;
  new.created_by      := old.created_by;
  new.updated_at      := now();
  new.updated_by      := auth.uid();
  return new;
end;
$$;

create trigger trg_company_revenues_touch
  before update on company_revenues
  for each row execute function company_revenues_touch();

create or replace function company_revenue_notes_touch()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.company_id      := old.company_id;
  new.reference_month := old.reference_month;
  new.updated_at      := now();
  new.updated_by      := auth.uid();
  return new;
end;
$$;

create trigger trg_company_revenue_notes_touch
  before update on company_revenue_notes
  for each row execute function company_revenue_notes_touch();

create or replace function company_sales_channels_touch()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.company_id := old.company_id;
  new.channel    := old.channel;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_company_sales_channels_touch
  before update on company_sales_channels
  for each row execute function company_sales_channels_touch();

-- ---------------------------------------------------------------------
-- RLS — mesmo predicado nas TRÊS tabelas: admin OU consultor vinculado à
-- empresa. Colaborador e anon não passam (o predicado NÃO inclui
-- my_collaborator_companies()).
-- ---------------------------------------------------------------------
alter table company_sales_channels enable row level security;
alter table company_revenues        enable row level security;
alter table company_revenue_notes   enable row level security;

create policy csc_rw on company_sales_channels for all
  using      (is_admin() or company_id in (select my_consultant_companies()))
  with check (is_admin() or company_id in (select my_consultant_companies()));

create policy crev_rw on company_revenues for all
  using      (is_admin() or company_id in (select my_consultant_companies()))
  with check (is_admin() or company_id in (select my_consultant_companies()));

create policy crn_rw on company_revenue_notes for all
  using      (is_admin() or company_id in (select my_consultant_companies()))
  with check (is_admin() or company_id in (select my_consultant_companies()));

-- ---------------------------------------------------------------------
-- Leitura agregada NO BANCO (nunca somar array no cliente: PostgREST trunca em
-- 1000 sem aviso e soma de dinheiro em float acumula centavo).
--
-- SECURITY INVOKER: o escopo é o RLS acima — admin tudo, consultor as dele,
-- qualquer outro recebe vazio. A função só reagrupa o que o usuário já pode ler.
--
-- Devolve, para UMA empresa:
--   currentMonth  — mês corrente em BRT (data pura "YYYY-MM-DD", dia 1).
--   channelConfig — { canal: active } (canais sem linha = ausentes = inativos).
--   activeChannels— canais ativos, na ordem do enum.
--   channelTotals — total acumulado por canal (inclui canais já desativados que
--                   têm histórico — desativar não esconde faturamento).
--   grandTotal    — total do projeto (todos os meses, todos os canais).
--   months        — do mês mais antigo lançado (ou o corrente, se nada) até o
--                   mais recente entre o corrente e o último lançado, SEM pular
--                   buracos (o buraco = "sem registro" é informação útil). Cada
--                   mês traz { month, channels:{canal:valor}, total, hasRecord,
--                   note }, do mais recente para o mais antigo.
-- ---------------------------------------------------------------------
create or replace function company_revenue_overview(p_company uuid)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with cur as (
    select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
             as this_month
  ),
  bounds as (
    select
      coalesce(min(reference_month), (select this_month from cur)) as first_month,
      greatest(
        (select this_month from cur),
        coalesce(max(reference_month), (select this_month from cur))
      ) as last_month
    from company_revenues
    where company_id = p_company
  ),
  months as (
    select gs::date as m
    from bounds,
         generate_series(bounds.first_month, bounds.last_month, interval '1 month') gs
  ),
  per_month as (
    select
      mo.m,
      coalesce(
        jsonb_object_agg(r.channel, r.amount) filter (where r.channel is not null),
        '{}'::jsonb
      ) as channels,
      coalesce(sum(r.amount), 0)::numeric(14,2) as total,
      count(r.*) as entry_count,
      (select n.note from company_revenue_notes n
        where n.company_id = p_company and n.reference_month = mo.m) as note
    from months mo
    left join company_revenues r
      on r.company_id = p_company and r.reference_month = mo.m
    group by mo.m
  )
  select jsonb_build_object(
    'currentMonth', to_char((select this_month from cur), 'YYYY-MM-DD'),
    'channelConfig', coalesce(
      (select jsonb_object_agg(channel, active)
         from company_sales_channels where company_id = p_company),
      '{}'::jsonb
    ),
    'activeChannels', coalesce(
      (select jsonb_agg(channel order by channel)
         from company_sales_channels
        where company_id = p_company and active),
      '[]'::jsonb
    ),
    'channelTotals', coalesce(
      (select jsonb_object_agg(channel, total)
         from (
           select channel, sum(amount)::numeric(14,2) as total
             from company_revenues where company_id = p_company
            group by channel
         ) ct),
      '{}'::jsonb
    ),
    'grandTotal', coalesce(
      (select sum(amount)::numeric(14,2) from company_revenues
        where company_id = p_company),
      0
    ),
    'months', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'month', to_char(pm.m, 'YYYY-MM-DD'),
                  'channels', pm.channels,
                  'total', pm.total,
                  'hasRecord', pm.entry_count > 0,
                  'note', pm.note
                ) order by pm.m desc)
         from per_month pm),
      '[]'::jsonb
    )
  );
$$;

grant execute on function company_revenue_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Grava o MÊS inteiro de uma vez (UPSERT por (empresa, mês, canal)):
--   · relançar um mês existente CORRIGE o valor, não duplica;
--   · amount NULL (campo deixado vazio na tela) REMOVE a linha do canal
--     naquele mês → volta a "sem registro" (distinto de zero digitado);
--   · a observação do mês é opcional (NULL/vazio remove a linha da nota).
--
-- p_entries: jsonb array [{ "channel": "shopee", "amount": "118400.50" }, ...]
--   amount é STRING decimal canônica (o parse pt-BR "118.400,50" → "118400.50"
--   é feito na server action, para NUNCA usar parseFloat na string do usuário);
--   amount ausente/null → remoção.
--
-- SECURITY INVOKER: as escritas passam pela RLS (WITH CHECK). Se o usuário não
-- tem acesso à empresa, o INSERT levanta 42501 e a action traduz para um aviso.
-- ---------------------------------------------------------------------
create or replace function company_revenue_upsert(
  p_company uuid,
  p_month   date,
  p_entries jsonb,
  p_note    text
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
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_chan := (e->>'channel')::sales_channel;
    v_raw  := e->>'amount';

    if v_raw is null or btrim(v_raw) = '' then
      -- Campo vazio: "sem registro" naquele canal — remove a linha se existir.
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

grant execute on function company_revenue_upsert(uuid, date, jsonb, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- Define quais canais a empresa usa, em lote (idempotente): upserta os quatro
-- canais com active = (canal ∈ p_active). Só liga/desliga o filtro do
-- formulário; NÃO toca em company_revenues (histórico preservado).
-- SECURITY INVOKER: RLS decide quem pode escrever.
-- ---------------------------------------------------------------------
create or replace function set_company_channels(
  p_company uuid,
  p_active  text[]
)
returns void
language sql security invoker set search_path = public
as $$
  insert into company_sales_channels (company_id, channel, active, updated_by)
  select p_company, c.ch, (c.ch::text = any(coalesce(p_active, '{}'))), auth.uid()
    from unnest(enum_range(null::sales_channel)) as c(ch)
  on conflict (company_id, channel)
  do update set active = excluded.active;  -- trigger carimba updated_*
$$;

grant execute on function set_company_channels(uuid, text[]) to authenticated;
