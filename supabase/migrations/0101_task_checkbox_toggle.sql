-- Marcar/desmarcar um item de checklist (taskItem do TipTap) na LEITURA do
-- conteúdo rich text, sem que isso conte como "edição".
--
-- Contexto: os campos rich text (Atualizações, respostas de atualização,
-- chamados de Suporte e respostas de chamado) podem ter listas de tarefas. Até
-- aqui a caixa só persistia quando marcada DENTRO do editor e salva. Na leitura
-- a caixa era um <input> nativo solto: marcar mexia só no DOM e sumia ao
-- recarregar. Agora a leitura grava o estado — mas marcar uma caixa NÃO pode
-- virar uma "edição" do texto (sem bumpar edited_at, sem trocar o autor da
-- edição, sem reprocessar @menções, sem evento de histórico, sem notificação).
--
-- Mecânica:
--  · Uma GUC transação-local `app.task_checkbox = '1'` sinaliza aos gatilhos de
--    auditoria que ESTA atualização é só um toggle de caixa. Nos gatilhos, o
--    ramo do toggle PRESERVA os carimbos de edição (edited_at / updated_at /
--    updated_by) — então o "editado" não aparece e nenhum carimbo se move.
--  · Como a GUC precisa valer na MESMA transação do UPDATE, o UPDATE passa por
--    uma RPC SECURITY INVOKER (a RLS de cada tabela continua sendo a barreira:
--    só escreve quem já pode editar aquele conteúdo). A RPC faz o UPDATE
--    casando o token de conflito (coalesce(carimbo, created_at)); se o texto
--    mudou desde que a tela carregou, 0 linhas → devolve NULL → a action recusa.
--  · A @menção não é tocada: ela é reprocessada só no fluxo de salvar do app
--    (syncMentions), que o toggle não chama. As notificações de resposta são
--    AFTER INSERT — um UPDATE não as dispara.

-- ---------------------------------------------------------------------------
-- 1) Gatilhos de auditoria: ramo do toggle preserva os carimbos de edição.
-- ---------------------------------------------------------------------------

-- Atualizações (company_notes): normalmente todo UPDATE carimba updated_at/_by.
-- No toggle, preserva ambos (o "Editado por … em …" é guiado por updated_at).
create or replace function public.company_notes_audit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.company_id := old.company_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if current_setting('app.task_checkbox', true) = '1' then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  else
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$function$;

-- Chamados de suporte (support_tickets): mesma ideia no ramo de UPDATE; o ramo
-- de INSERT e a trava de conteúdo de não-autor continuam intactos.
create or replace function public.support_tickets_audit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    new.finished_at := case when new.status = 'finalizado' then now() else null end;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if auth.uid() <> old.created_by and not is_admin() then
    new.title        := old.title;
    new.context_html := old.context_html;
    new.attachments  := old.attachments;
  end if;

  if current_setting('app.task_checkbox', true) = '1' then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  else
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;

  if new.status = 'finalizado' and old.status is distinct from 'finalizado' then
    new.finished_at := now();
  elsif new.status is distinct from 'finalizado' then
    new.finished_at := null;
  end if;

  return new;
end;
$function$;

-- Respostas de atualização (company_note_replies): normalmente marca edited_at
-- quando corpo/anexos mudam. No toggle, preserva edited_at.
create or replace function public.company_note_replies_audit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.note_id    := old.note_id;
  new.parent_id  := old.parent_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if current_setting('app.task_checkbox', true) = '1' then
    new.edited_at := old.edited_at;
  elsif new.body_html is distinct from old.body_html
     or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end;
$function$;

-- Respostas de chamado (support_ticket_replies): idem.
create or replace function public.support_ticket_replies_audit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.ticket_id  := old.ticket_id;
  new.parent_id  := old.parent_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  if current_setting('app.task_checkbox', true) = '1' then
    new.edited_at := old.edited_at;
  elsif new.body_html is distinct from old.body_html
     or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) RPCs do toggle (SECURITY INVOKER): setam a GUC transação-local e fazem o
--    UPDATE com trava otimista pelo token de conflito. Devolvem o token novo
--    (ou NULL se nada casou: texto mudado por outra pessoa ou sem permissão
--    de edição pela RLS).
-- ---------------------------------------------------------------------------

create or replace function public.toggle_note_checkbox(
  p_id uuid, p_html text, p_token timestamptz
) returns timestamptz
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare v timestamptz;
begin
  perform set_config('app.task_checkbox', '1', true);
  update public.company_notes
     set content_html = p_html
   where id = p_id
     and coalesce(updated_at, created_at) = p_token
  returning coalesce(updated_at, created_at) into v;
  return v;
end;
$function$;

create or replace function public.toggle_ticket_checkbox(
  p_id uuid, p_html text, p_token timestamptz
) returns timestamptz
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare v timestamptz;
begin
  perform set_config('app.task_checkbox', '1', true);
  update public.support_tickets
     set context_html = p_html
   where id = p_id
     and coalesce(updated_at, created_at) = p_token
  returning coalesce(updated_at, created_at) into v;
  return v;
end;
$function$;

create or replace function public.toggle_note_reply_checkbox(
  p_id uuid, p_html text, p_token timestamptz
) returns timestamptz
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare v timestamptz;
begin
  perform set_config('app.task_checkbox', '1', true);
  update public.company_note_replies
     set body_html = p_html
   where id = p_id
     and coalesce(edited_at, created_at) = p_token
  returning coalesce(edited_at, created_at) into v;
  return v;
end;
$function$;

create or replace function public.toggle_ticket_reply_checkbox(
  p_id uuid, p_html text, p_token timestamptz
) returns timestamptz
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare v timestamptz;
begin
  perform set_config('app.task_checkbox', '1', true);
  update public.support_ticket_replies
     set body_html = p_html
   where id = p_id
     and coalesce(edited_at, created_at) = p_token
  returning coalesce(edited_at, created_at) into v;
  return v;
end;
$function$;

grant execute on function public.toggle_note_checkbox(uuid, text, timestamptz) to authenticated;
grant execute on function public.toggle_ticket_checkbox(uuid, text, timestamptz) to authenticated;
grant execute on function public.toggle_note_reply_checkbox(uuid, text, timestamptz) to authenticated;
grant execute on function public.toggle_ticket_reply_checkbox(uuid, text, timestamptz) to authenticated;
