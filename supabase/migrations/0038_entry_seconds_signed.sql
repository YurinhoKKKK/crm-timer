-- =====================================================================
-- Correção da entry_seconds (migration 0037): preservar o SINAL do seconds.
-- =====================================================================
-- As correções manuais de tempo (passo 16, admin_adjust_time) inserem um
-- intervalo de RECONCILIAÇÃO com seconds = novo_total - soma_atual. Quando o
-- admin REDUZ o tempo, esse seconds é NEGATIVO — é o mecanismo que mantém
-- sum(time_entries) = total_seconds da tarefa (6 entries negativos hoje,
-- somando -26.511s).
--
-- A entry_seconds original clampava TODO valor com greatest(0, ...), zerando
-- esses negativos — o que superestimaria por período as tarefas ajustadas para
-- baixo e quebraria o casamento com total_seconds. O clamp em zero deve valer
-- APENAS para o intervalo ABERTO (valor derivado de now() - started_at, onde um
-- negativo só viria de relógio torto). Para intervalo fechado, usa-se o seconds
-- gravado como está, com sinal.
-- =====================================================================
create or replace function entry_seconds(
  p_seconds int, p_started timestamptz, p_ended timestamptz
) returns int
language sql
stable
set search_path = public
as $$
  select case
    when p_seconds is not null then p_seconds
    else greatest(0, floor(extract(epoch from (coalesce(p_ended, now()) - p_started)))::int)
  end;
$$;
