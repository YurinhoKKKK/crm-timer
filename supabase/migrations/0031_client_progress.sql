-- =====================================================================
-- PASSO 25.1 — Aba "Andamento" do portal do cliente
--
-- O cliente passa a acompanhar um FEED CURADO de tarefas da empresa dele:
-- só únicas comuns (kind='unica', template_type='padrao', sem vínculo com
-- o catálogo de tarefas padrão), só iniciadas/finalizadas e não ocultadas.
-- Campos entregues: título, estado curado ('em_andamento' | 'entregue') e,
-- para entregues, SÓ A DATA de conclusão (fuso de Brasília) — nada de hora,
-- tempo gasto, prazo, atraso, responsável ou resumo de finalização: esses
-- campos NÃO saem do banco (a função não os seleciona).
--
-- BLINDAGEM (mesma arquitetura do passo 25): a função é SECURITY DEFINER e
-- deriva a empresa DA SESSÃO validada (token + segredo) — não recebe
-- company_id. Sessão de outra empresa/expirada/revogada => null.
--
-- Opt-out por exceção: task_instances.client_hidden (default false = tudo
-- elegível aparece). Só admin/consultor DA EMPRESA alteram a coluna — o
-- gatilho abaixo garante isso por coluna (a RLS de UPDATE é por linha e o
-- colaborador pode atualizar a própria tarefa; sem o gatilho ele conseguiria
-- flipar o client_hidden junto).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Coluna de opt-out
-- ---------------------------------------------------------------------
alter table task_instances
  add column client_hidden boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Guarda de COLUNA: só admin / consultor da empresa mudam client_hidden
-- ---------------------------------------------------------------------
-- auth.uid() null e linha alcançada = service role / manutenção (a RLS já
-- barrou anon antes do gatilho disparar); usuários autenticados precisam
-- ser admin ou consultor da empresa. As funções de timer (SECURITY DEFINER,
-- chamadas pelo executor) não tocam a coluna, então passam direto.
create or replace function guard_client_hidden()
returns trigger
language plpgsql
as $$
begin
  if new.client_hidden is distinct from old.client_hidden then
    if auth.uid() is not null
       and not (is_admin()
                or old.company_id in (select my_consultant_companies())) then
      raise exception
        'apenas admin ou o consultor da empresa podem ocultar/mostrar ao cliente';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_client_hidden
  before update on task_instances
  for each row execute function guard_client_hidden();

-- ---------------------------------------------------------------------
-- 3. Feed do portal (anon, com sessão válida) — paginado no servidor
-- ---------------------------------------------------------------------
create or replace function client_portal_progress(
  p_token text,
  p_session text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  -- Empresa derivada DA SESSÃO (token + segredo em hash, não expirada).
  select s.company_id into v_company
    from client_portal_sessions s
    join client_portal_access a on a.company_id = s.company_id
   where a.token = p_token
     and a.active
     and s.secret_hash = encode(digest(p_session, 'sha256'), 'hex')
     and s.expires_at > now();

  if v_company is null then
    return null;
  end if;

  -- Total (decide se a aba aparece e alimenta o "ver mais").
  select count(*) into v_total
    from task_instances ti
    join task_templates tt on tt.id = ti.template_id
   where ti.company_id = v_company
     and tt.kind = 'unica'
     and tt.template_type = 'padrao'
     and tt.standard_task_id is null
     and ti.status in ('iniciada', 'finalizada')
     and not ti.client_hidden;

  -- Página: em andamento primeiro, depois entregues (mais recente primeiro).
  -- O jsonb_agg reordena pelas MESMAS chaves da página (window functions
  -- rodam antes do ORDER BY, então um row_number aqui não preservaria).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'title', page.title,
             'state', case when page.status = 'iniciada'
                           then 'em_andamento' else 'entregue' end,
             'done_on', case when page.status = 'finalizada'
                             then to_char(page.finished_at
                                          at time zone 'America/Sao_Paulo',
                                          'YYYY-MM-DD')
                             else null end
           )
           order by page.is_open desc, page.sort_at desc, page.id
         ), '[]'::jsonb)
    into v_items
    from (
      select ti.id, ti.title, ti.status, ti.finished_at,
             (ti.status = 'iniciada') as is_open,
             coalesce(ti.finished_at, ti.created_at) as sort_at
        from task_instances ti
        join task_templates tt on tt.id = ti.template_id
       where ti.company_id = v_company
         and tt.kind = 'unica'
         and tt.template_type = 'padrao'
         and tt.standard_task_id is null
         and ti.status in ('iniciada', 'finalizada')
         and not ti.client_hidden
       order by (ti.status = 'iniciada') desc,
                coalesce(ti.finished_at, ti.created_at) desc,
                ti.id
       limit v_limit offset v_offset
    ) page;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

grant execute on function client_portal_progress(text, text, integer, integer)
  to anon, authenticated;
