-- =====================================================================
-- CRM/Timer - Monvatti :: Correção de timeout ao finalizar Listagens com
-- muitas marcas (ex.: "Analise de item" com 16 marcas devolvia
-- "canceling statement due to statement timeout").
-- =====================================================================
-- CAUSA:
-- 1) timer_finish_listing inseria os resultados num LOOP plpgsql (1 INSERT por
--    marca). Com 16 marcas eram 17 comandos dentro do MESMO statement_timeout
--    de 8s do papel authenticated.
-- 2) As policies de RLS envolvidas chamavam auth.uid() DIRETO na subconsulta.
--    Sem (select auth.uid()) o planejador reavalia a função por linha, em cada
--    comando — antipadrão de RLS documentado pelo Supabase.
--
-- Esta migration:
--  (1) troca o LOOP por um ÚNICO INSERT ... SELECT a partir do jsonb;
--  (2) envolve auth.uid() em subconsulta escalar nas policies do fluxo, para o
--      valor ser avaliado UMA vez por comando e não por linha.
--
-- IMPORTANTE: (2) é OTIMIZAÇÃO, não afrouxamento. O predicado lógico continua
-- EXATAMENTE o mesmo — auth.uid() é constante dentro de uma consulta, então
-- (select auth.uid()) devolve o mesmo valor. Nenhuma linha passa a ser visível
-- ou gravável por quem não podia antes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) timer_finish_listing sem o laço. Todo o resto do comportamento é igual:
--     fechamento das time_entries, soma do total, update das task_instances com
--     a checagem collaborator_id = v_collab, o raise de 'tarefa nao encontrada',
--     o delete prévio dos resultados e o insert condicional no activity_log.
--     Assinatura e retorno inalterados.
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

  -- Substitui os resultados desta tarefa pelos informados, num único comando.
  delete from listing_results where task_id = p_task;
  insert into listing_results (task_id, brand_id, marketplace, link, not_done_reason)
  select p_task,
         (x->>'brand_id')::uuid,
         (x->>'marketplace')::listing_marketplace,
         nullif(btrim(coalesce(x->>'link', '')), ''),
         nullif(btrim(coalesce(x->>'reason', '')), '')
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) as x;

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

-- ---------------------------------------------------------------------
-- (2) Policies: (select auth.uid()) no lugar de auth.uid() direto. Mesmo
--     predicado lógico, avaliado uma vez por comando.
-- ---------------------------------------------------------------------

-- listing_results: escrita do executor (dono da tarefa).
alter policy lr_write on listing_results
  using (
    task_id in (select id from task_instances where collaborator_id = (select auth.uid()))
  )
  with check (
    task_id in (select id from task_instances where collaborator_id = (select auth.uid()))
  );

-- time_entries: colaborador atualiza os próprios intervalos.
alter policy te_update on time_entries
  using (collaborator_id = (select auth.uid()))
  with check (collaborator_id = (select auth.uid()));

-- task_instances: colaborador atualiza as próprias tarefas (admin/consultor mantidos).
alter policy ti_update_collaborator on task_instances
  using (collaborator_id = (select auth.uid()) or is_admin()
         or company_id in (select my_consultant_companies()))
  with check (collaborator_id = (select auth.uid()) or is_admin()
         or company_id in (select my_consultant_companies()));

-- task_instances: colaborador vê as próprias tarefas (admin/consultor mantidos).
alter policy ti_select on task_instances
  using (
    is_admin()
    or collaborator_id = (select auth.uid())
    or company_id in (select my_consultant_companies())
  );

-- activity_log: colaborador vê os próprios registros (admin/consultor mantidos).
alter policy al_select on activity_log
  using (
    is_admin()
    or collaborator_id = (select auth.uid())
    or company_id in (select my_consultant_companies())
  );
