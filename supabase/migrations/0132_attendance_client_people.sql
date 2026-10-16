-- =====================================================================
-- CRM/Timer - Monvatti :: Capacidade de atendimento — detalhe por cliente
-- =====================================================================
-- Só para a reorganização da seção "Atendimento por WhatsApp" (etapa 3): o painel
-- de detalhe de um cliente mostra as PESSOAS que o atenderam, com as horas de cada.
-- É um agregado novo (somado no banco, admin-only); nenhuma regra de cálculo muda.
-- =====================================================================

create or replace function attendance_capacity_client_people(
  p_start date, p_end date, p_company_id uuid
)
returns table(person_label text, hours numeric)
language sql stable security definer set search_path = public
as $$
  with ct as (
    select whatsapp_contact_id as contact_id
      from companies where id = p_company_id and whatsapp_contact_id is not null
  )
  select
    case when e.digisac_user_id is null then 'Equipe (não identificado)'
         when du.profile_id is not null then pr.full_name
         else coalesce(du.name, '(sem nome)') || ' (sem perfil)' end as person_label,
    round(sum(e.minutes) / 60.0, 2) as hours
  from attendance_estimates e
  join ct on ct.contact_id = e.contact_id
  left join digisac_users du on du.id = e.digisac_user_id
  left join profiles pr on pr.id = du.profile_id
  where e.day between p_start and p_end and (select is_admin())
  group by 1
  order by sum(e.minutes) desc;
$$;

grant execute on function attendance_capacity_client_people(date, date, uuid) to authenticated;
