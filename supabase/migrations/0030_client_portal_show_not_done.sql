-- =====================================================================
-- Passo 25 (ajuste): o cliente TAMBÉM vê as listagens não feitas, com a
-- justificativa — se a marca não tem relevância no marketplace, o cliente
-- lê o porquê e entende a decisão. Cada resultado tem OU link OU
-- justificativa (constraint listing_results_link_xor_reason).
-- =====================================================================

create or replace function client_portal_data(p_token text, p_session text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_company uuid;
begin
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

  return jsonb_build_object(
    'company_name', (select name from companies where id = v_company),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'brand', lb.name,
               'marketplace', lr.marketplace,
               'link', lr.link,
               'reason', lr.not_done_reason,
               'date', coalesce(ti.finished_at, ti.task_date::timestamptz)
             ) order by coalesce(ti.finished_at, ti.task_date::timestamptz) desc,
                        lb.name)
        from listing_results lr
        join listing_brands lb on lb.id = lr.brand_id
        join task_instances ti on ti.id = lr.task_id
       where ti.company_id = v_company
    ), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'html', n.content_html,
               'at', n.created_at
             ) order by n.created_at desc)
        from company_notes n
       where n.company_id = v_company
         and n.visible_to_client
    ), '[]'::jsonb)
  );
end;
$$;
