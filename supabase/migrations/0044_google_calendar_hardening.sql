-- =====================================================================
-- GOOGLE CALENDAR — ENDURECIMENTO (segue a 0043)
--
-- Corrige dois pontos achados na auditoria:
--   1. GRANTS ASSIMÉTRICOS: o Supabase concede GRANT ALL a anon/authenticated
--      por padrão; a 0043 só reapertou o SELECT das colunas de token para
--      `authenticated`, deixando `anon` com SELECT em access_token_enc/
--      refresh_token_enc (inofensivo hoje — RLS exige auth.uid(), nulo p/ anon —
--      mas assimétrico). Aqui igualamos por baixo: anon perde tudo nas tabelas
--      novas; na tabela de token, TODA escrita passa só pelas funções
--      SECURITY DEFINER (que rodam como dono e não dependem destes grants), então
--      authenticated também fica só com o SELECT de metadados.
--   2. RECURSÃO MÚTUA: meetings_select e mp_select se referenciavam em
--      subconsulta (meetings -> meeting_participants -> meetings), o que dispara
--      "infinite recursion detected in policy" em QUALQUER select autenticado em
--      meetings. Extraímos a visibilidade para uma função SECURITY DEFINER
--      (bypassa RLS por dentro, quebrando o ciclo) e a usamos nas duas policies —
--      além de tornar o critério explícito e de fonte única.
-- Aditiva: não cria/altera tabela; só reaperta grants e redefine 2 policies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Grants — tirar o excesso do default do Supabase
-- ---------------------------------------------------------------------

-- google_accounts (tabela sensível): anon não toca em nada. authenticated só
-- LÊ metadados da própria linha (RLS ga_select_own). Escrita: só funções DEFINER.
revoke all on google_accounts from anon;
revoke all on google_accounts from authenticated;
grant select (user_id, google_email, token_expiry, scope, connected_at, updated_at)
  on google_accounts to authenticated;

-- google_calendar_audit: leitura própria/admin por RLS; escrita só por função.
-- anon: nada. authenticated: mantém só SELECT.
revoke all on google_calendar_audit from anon;
revoke insert, update, delete, truncate, references on google_calendar_audit from authenticated;

-- meetings / meeting_participants: anon não tem policy nenhuma -> zero acesso.
revoke all on meetings             from anon;
revoke all on meeting_participants from anon;
-- meetings não tem policy de DELETE -> authenticated não apaga direto.
revoke delete, truncate on meetings from authenticated;

-- ---------------------------------------------------------------------
-- 2. Visibilidade de reunião — função única, sem recursão
-- ---------------------------------------------------------------------
-- SECURITY DEFINER: por dentro, o RLS de meetings/meeting_participants NÃO
-- re-dispara (roda como dono), então não há recursão. Só decide a visibilidade
-- do PRÓPRIO chamador (auth.uid()); devolve booleano, nunca dado.
create or replace function meeting_is_visible(p_meeting uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from meetings m
    where m.id = p_meeting
      and (
        is_admin()
        or m.created_by = auth.uid()
        or m.company_id in (select my_consultant_companies())
        or exists (select 1 from meeting_participants mp
                    where mp.meeting_id = m.id and mp.user_id = auth.uid())
      )
  );
$$;

revoke execute on function meeting_is_visible(uuid) from public, anon;
grant  execute on function meeting_is_visible(uuid) to authenticated;

-- Reescreve as duas policies de SELECT para usar a função. Critério idêntico ao
-- da 0043, agora explícito e sem o ciclo entre as duas tabelas.
drop policy meetings_select on meetings;
create policy meetings_select on meetings for select
  using (meeting_is_visible(id));

drop policy mp_select on meeting_participants;
create policy mp_select on meeting_participants for select
  using (meeting_is_visible(meeting_id));
