-- =====================================================================
-- Passo 15: Tarefas padrão (catálogo reutilizável)
-- =====================================================================
-- Um catálogo de MOLDES de tarefa reutilizáveis, desacoplados de empresa.
-- O admin cria/edita/exclui as tarefas padrão; admin e consultor as ATRIBUEM
-- a empresas. Ao atribuir, nasce um task_template normal (com empresa e
-- responsável) ligado à padrão por standard_task_id. A partir daí toda a
-- maquinaria existente (trg_unique_template, generate_daily_tasks, timer)
-- funciona sem mudanças.
--
-- Vínculo vivo com congelamento do histórico:
--   Editar a padrão -> sync_standard_task propaga para os templates ligados
--   e para as instâncias AINDA a_fazer. Instâncias iniciadas/finalizadas/
--   canceladas ficam CONGELADAS (histórico do que foi realmente feito).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo de tarefas padrão (o molde puro, sem empresa/responsável)
-- ---------------------------------------------------------------------
create table standard_tasks (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null,
  description  text,
  instructions text,
  kind         task_kind not null,              -- 'unica' ou 'diaria'
  weekdays     smallint[] default '{}',         -- só para kind='diaria'
  due_time     time,                            -- horário-limite padrão
  active       boolean not null default true,   -- arquivar do catálogo sem excluir
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_standard_tasks_updated before update on standard_tasks
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Ligação da instância-molde (task_template) de volta à padrão.
--    ON DELETE SET NULL: excluir a padrão do catálogo não apaga o que já
--    foi atribuído/executado nas empresas — apenas rompe o vínculo vivo.
-- ---------------------------------------------------------------------
alter table task_templates
  add column standard_task_id uuid references standard_tasks(id) on delete set null;

create index idx_task_templates_standard on task_templates(standard_task_id);

-- ---------------------------------------------------------------------
-- 3. RLS
--    Leitura: admin e consultor (ambos precisam ver o catálogo para atribuir).
--    Escrita (criar/editar/excluir molde): somente admin — é recurso global.
-- ---------------------------------------------------------------------
alter table standard_tasks enable row level security;

create policy st_select on standard_tasks for select
  using (is_admin() or auth_role() = 'consultor');

create policy st_admin_all on standard_tasks for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 4. Propagação da edição da padrão (vínculo vivo)
--    - Atualiza os campos-molde de todos os task_templates ligados.
--    - Propaga para as instâncias a_fazer (título, textos e prazo do dia).
--    - NÃO toca em company_id, collaborator_id nem start_date (são da
--      atribuição, não do molde) e NÃO toca em instâncias já iniciadas/
--      finalizadas/canceladas (congelamento do histórico).
--    Só o admin edita a padrão; a checagem is_admin() reforça no banco.
-- ---------------------------------------------------------------------
create or replace function sync_standard_task(p_standard uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  std record;
  updated_count integer := 0;
begin
  select * into std from standard_tasks where id = p_standard;
  if not found then
    return 0;
  end if;

  if not is_admin() then
    raise exception 'not authorized';
  end if;

  -- 1. campos-molde -> templates ligados
  update task_templates
  set title        = std.title,
      description  = std.description,
      instructions = std.instructions,
      kind         = std.kind,
      weekdays     = case when std.kind = 'diaria' then std.weekdays else '{}' end,
      due_time     = std.due_time
  where standard_task_id = p_standard;

  -- 2. campos -> instâncias ainda a_fazer (congela as demais)
  update task_instances ti
  set title        = std.title,
      description  = std.description,
      instructions = std.instructions,
      due_at       = (
        ti.task_date::text || ' ' || coalesce(std.due_time, '23:59')::text
      )::timestamptz
  from task_templates tt
  where ti.template_id = tt.id
    and tt.standard_task_id = p_standard
    and ti.status = 'a_fazer';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function sync_standard_task(uuid) to authenticated;
