-- =====================================================================
-- Correção: registros duplicados por clique repetido (double-submit)
-- =====================================================================
-- Camada de banco (rede de segurança real, além do bloqueio no botão).
-- Estratégia: gatilho BEFORE INSERT que bloqueia um registro "idêntico"
-- criado na MESMA JANELA DE TEMPO (poucos segundos). Isso pega o padrão do
-- bug (a pessoa clica de novo achando que não funcionou) sem impedir criar,
-- mais tarde, um registro legitimamente parecido.
--
-- pg_advisory_xact_lock serializa inserts de mesma identidade: numa corrida
-- real (dois pedidos quase simultâneos), o segundo espera o primeiro commitar,
-- então enxerga a linha recém-criada e é bloqueado. Sem isso, duas transações
-- simultâneas não se enxergariam e ambas gravariam.
--
-- NÃO tocamos em task_instances: a recorrência diária gera uma instância por
-- dia de propósito (protegida por unique(template_id, task_date)).
-- company_consultants já tem PK composta (sem duplicata possível).
--
-- Janela: 15 segundos. Um humano não repreenche um formulário inteiro em 15s,
-- então não bloqueia criação legítima; e cobre com folga o clique nervoso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Empresas — identidade: nome (normalizado). Só o admin cria empresas.
-- ---------------------------------------------------------------------
create or replace function dedup_companies()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text := lower(trim(new.name));
  v_recent int;
begin
  perform pg_advisory_xact_lock(hashtext('dedup:companies:' || v_key));
  select count(*) into v_recent
  from companies
  where lower(trim(name)) = v_key
    and created_at > now() - interval '15 seconds';
  if v_recent > 0 then
    raise exception 'Empresa "%" foi criada agora há pouco (possível clique repetido). Se for mesmo outra empresa com o mesmo nome, aguarde alguns segundos e tente de novo.', new.name
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dedup_companies on companies;
create trigger trg_dedup_companies
  before insert on companies
  for each row execute function dedup_companies();

-- ---------------------------------------------------------------------
-- Tarefas (task_templates) — identidade: empresa + responsável + título +
-- tipo. Só vale para tarefas criadas manualmente (standard_task_id IS NULL);
-- as geradas por atribuição de tarefa padrão já têm dedup próprio no núcleo
-- do vínculo (e podem, legitimamente, coincidir em título num mesmo lote).
-- ---------------------------------------------------------------------
create or replace function dedup_task_templates()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_title text := lower(trim(new.title));
  v_recent int;
begin
  if new.standard_task_id is not null then
    return new; -- atribuição de padrão: dedup é feito no núcleo do vínculo
  end if;

  perform pg_advisory_xact_lock(
    hashtext('dedup:tt:' || new.company_id::text || ':' ||
             new.collaborator_id::text || ':' || v_title || ':' || new.kind::text)
  );
  select count(*) into v_recent
  from task_templates
  where standard_task_id is null
    and company_id = new.company_id
    and collaborator_id = new.collaborator_id
    and kind = new.kind
    and lower(trim(title)) = v_title
    and created_at > now() - interval '15 seconds';
  if v_recent > 0 then
    raise exception 'Tarefa "%" foi criada agora há pouco para este responsável nesta empresa (possível clique repetido).', new.title
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dedup_task_templates on task_templates;
create trigger trg_dedup_task_templates
  before insert on task_templates
  for each row execute function dedup_task_templates();

-- ---------------------------------------------------------------------
-- Tarefas padrão (catálogo) — identidade: título (normalizado) + tipo.
-- Só o admin cria. created_at existe em standard_tasks.
-- ---------------------------------------------------------------------
create or replace function dedup_standard_tasks()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_title text := lower(trim(new.title));
  v_recent int;
begin
  perform pg_advisory_xact_lock(
    hashtext('dedup:st:' || v_title || ':' || new.kind::text)
  );
  select count(*) into v_recent
  from standard_tasks
  where kind = new.kind
    and lower(trim(title)) = v_title
    and created_at > now() - interval '15 seconds';
  if v_recent > 0 then
    raise exception 'Tarefa padrão "%" foi criada agora há pouco (possível clique repetido).', new.title
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dedup_standard_tasks on standard_tasks;
create trigger trg_dedup_standard_tasks
  before insert on standard_tasks
  for each row execute function dedup_standard_tasks();
