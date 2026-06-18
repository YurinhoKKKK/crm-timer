-- =====================================================================
-- CRM/Timer - Monvatti :: Schema inicial
-- =====================================================================
-- Cargos: admin, consultor, colaborador (+ status pending para novos)
-- Regras de acesso garantidas por RLS.
-- =====================================================================

create extension if not exists "uuid-ossp" with schema extensions;

-- =====================================================================
-- ENUMS
-- =====================================================================
create type user_role   as enum ('admin', 'consultor', 'colaborador', 'pending');
create type task_kind   as enum ('unica', 'diaria');           -- molde: única ou recorrente
create type task_status as enum ('a_fazer', 'iniciada', 'finalizada', 'cancelada');

-- =====================================================================
-- PROFILES  (extende auth.users)
-- =====================================================================
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        user_role not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- COMPANIES (clientes)
-- whatsapp_contact_id = contactId do grupo na Digisac (validado no teste)
-- =====================================================================
create table companies (
  id                   uuid primary key default uuid_generate_v4(),
  name                 text not null,
  whatsapp_contact_id  text,           -- contactId do grupo Digisac (pode ser nulo até vincular)
  whatsapp_group_name  text,           -- nome do grupo (cache, para exibir)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Consultor responsável por cada empresa (atribuído pelo admin).
-- Uma empresa pertence a um consultor; um consultor tem várias empresas.
create table company_consultants (
  company_id    uuid not null references companies(id) on delete cascade,
  consultant_id uuid not null references profiles(id) on delete cascade,
  assigned_at   timestamptz not null default now(),
  primary key (company_id, consultant_id)
);

-- OBS.: não há tabela de colaboradores por empresa.
-- O vínculo colaborador <-> empresa é DERIVADO: o colaborador "pertence"
-- a uma empresa enquanto tiver ao menos uma task_instance atribuída a ele nela.

-- =====================================================================
-- TASK TEMPLATES (molde da tarefa)
-- weekdays: para tarefas diárias, array de 0-6 (0=domingo) indicando repetição.
-- =====================================================================
create table task_templates (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  collaborator_id uuid not null references profiles(id) on delete cascade,
  created_by      uuid not null references profiles(id),
  title           text not null,
  description     text,
  instructions    text,
  kind            task_kind not null,
  weekdays        smallint[] default '{}',     -- só para kind='diaria'
  due_time        time,                        -- horário-limite padrão (ex: 18:00)
  start_date      date not null default current_date,
  end_date        date,                        -- opcional: até quando recorre
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- =====================================================================
-- TASK INSTANCES (execução concreta — o que o colaborador vê/cronometra)
-- =====================================================================
create table task_instances (
  id              uuid primary key default uuid_generate_v4(),
  template_id     uuid references task_templates(id) on delete set null,
  company_id      uuid not null references companies(id) on delete cascade,
  collaborator_id uuid not null references profiles(id) on delete cascade,
  title           text not null,
  description     text,
  instructions    text,
  status          task_status not null default 'a_fazer',
  due_at          timestamptz,                 -- prazo concreto (data+hora)
  task_date       date not null default current_date,  -- dia a que se refere
  total_seconds   integer not null default 0,  -- soma do tempo (atualizado ao pausar/finalizar)
  completion_note text,                        -- mensagem escrita ao finalizar
  note_sent_whatsapp boolean not null default false,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  -- evita duplicar a mesma recorrência no mesmo dia
  unique (template_id, task_date)
);

-- =====================================================================
-- TIME ENTRIES (cada play/pause — registro preciso solicitado)
-- =====================================================================
create table time_entries (
  id            uuid primary key default uuid_generate_v4(),
  task_id       uuid not null references task_instances(id) on delete cascade,
  collaborator_id uuid not null references profiles(id) on delete cascade,
  started_at    timestamptz not null,
  ended_at      timestamptz,                   -- nulo enquanto rodando
  seconds       integer,                       -- preenchido ao fechar o intervalo
  created_at    timestamptz not null default now()
);

-- =====================================================================
-- ACTIVITY LOG (registro de atividades por empresa)
-- Toda finalização entra aqui, enviada ou não ao WhatsApp.
-- =====================================================================
create table activity_log (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  task_id       uuid references task_instances(id) on delete set null,
  collaborator_id uuid not null references profiles(id) on delete cascade,
  message       text not null,
  seconds_spent integer not null default 0,
  sent_whatsapp boolean not null default false,
  created_at    timestamptz not null default now()
);

-- =====================================================================
-- ÍNDICES
-- =====================================================================
create index idx_task_instances_collaborator on task_instances(collaborator_id);
create index idx_task_instances_company      on task_instances(company_id);
create index idx_task_instances_status       on task_instances(status);
create index idx_task_instances_due          on task_instances(due_at);
create index idx_time_entries_task           on time_entries(task_id);
create index idx_activity_log_company        on activity_log(company_id);
create index idx_company_consultants_consultant on company_consultants(consultant_id);
