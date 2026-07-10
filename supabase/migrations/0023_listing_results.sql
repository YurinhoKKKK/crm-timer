-- =====================================================================
-- CRM/Timer - Monvatti :: Passo 22.1 — finalização da "Listagem de marcas"
-- =====================================================================
-- A listagem de marcas (0022) não finaliza com o "resumo do que foi feito" das
-- tarefas comuns. O entregável são os LINKS das planilhas de cada listagem: para
-- cada combinação MARCA × MARKETPLACE da tarefa, o colaborador informa OU o link
-- da planilha OU uma justificativa de "não foi feita". O resumo em texto passa a
-- ser OPCIONAL (e segue a mesma escolha de enviar ao cliente / só registrar).
-- =====================================================================

-- Resultado por combinação (marca × marketplace) de uma instância de listagem.
create table listing_results (
  id              uuid primary key default uuid_generate_v4(),
  task_id         uuid not null references task_instances(id) on delete cascade,
  brand_id        uuid not null references listing_brands(id) on delete cascade,
  marketplace     listing_marketplace not null,
  link            text,
  not_done_reason text,
  created_at      timestamptz not null default now(),
  unique (task_id, brand_id, marketplace),
  -- Cada combinação tem OU link OU justificativa (exatamente um, não vazio).
  constraint listing_results_link_xor_reason check (
    (link is not null and btrim(link) <> '' and not_done_reason is null)
    or (not_done_reason is not null and btrim(not_done_reason) <> '' and link is null)
  )
);

create index idx_listing_results_task on listing_results(task_id);

-- ---------------------------------------------------------------------
-- RLS: leitura segue a hierarquia da task_instances (a subconsulta já é
-- filtrada pela RLS ti_select — admin, consultor da empresa, colaborador dono).
-- Escrita é do EXECUTOR (colaborador dono da tarefa; admin/consultor que executa
-- via "Meu Trabalho" também cai aqui, pois vira collaborator_id = auth.uid()).
-- ---------------------------------------------------------------------
alter table listing_results enable row level security;

create policy lr_select on listing_results for select
  using (task_id in (select id from task_instances));

create policy lr_write on listing_results for all
  using (
    task_id in (select id from task_instances where collaborator_id = auth.uid())
  )
  with check (
    task_id in (select id from task_instances where collaborator_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- timer_finish_listing: finaliza uma listagem. Igual ao timer_finish (fecha o
-- intervalo aberto, soma o tempo, marca finalizada, grava finished_at), mas:
-- - o resumo (p_note) é OPCIONAL; só entra no activity_log/WhatsApp se houver;
-- - grava os resultados por combinação (substitui os anteriores), validados pela
--   constraint link_xor_reason. Tudo numa transação (a função é atômica).
-- p_results: jsonb array de { brand_id, marketplace, link, reason }.
-- ---------------------------------------------------------------------
create or replace function timer_finish_listing(
  p_task uuid, p_note text, p_send boolean, p_results jsonb
)
returns integer
language plpgsql
as $$
declare
  v_collab  uuid := auth.uid();
  v_total   integer;
  v_company uuid;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  r         jsonb;
begin
  update time_entries
    set ended_at = now(),
        seconds = greatest(0, floor(extract(epoch from (now() - started_at)))::int)
    where task_id = p_task and collaborator_id = v_collab and ended_at is null;

  select coalesce(sum(seconds), 0) into v_total from time_entries
    where task_id = p_task and collaborator_id = v_collab and seconds is not null;

  update task_instances
    set status = 'finalizada',
        total_seconds = v_total,
        completion_note = v_note,
        finished_at = now(),
        note_sent_whatsapp = (p_send and v_note is not null)
    where id = p_task and collaborator_id = v_collab
    returning company_id into v_company;

  if v_company is null then
    raise exception 'tarefa nao encontrada';
  end if;

  -- Substitui os resultados desta tarefa pelos informados.
  delete from listing_results where task_id = p_task;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    insert into listing_results (task_id, brand_id, marketplace, link, not_done_reason)
    values (
      p_task,
      (r->>'brand_id')::uuid,
      (r->>'marketplace')::listing_marketplace,
      nullif(btrim(coalesce(r->>'link', '')), ''),
      nullif(btrim(coalesce(r->>'reason', '')), '')
    );
  end loop;

  -- Resumo em texto é opcional: só vira histórico/WhatsApp se preenchido.
  if v_note is not null then
    insert into activity_log
      (company_id, task_id, collaborator_id, message, seconds_spent, sent_whatsapp)
    values
      (v_company, p_task, v_collab, v_note, v_total, p_send);
  end if;

  return v_total;
end;
$$;
