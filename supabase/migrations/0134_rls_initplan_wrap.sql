set local lock_timeout = '3s';
-- =====================================================================
-- 0134_rls_initplan_wrap :: CRM/Timer - Monvatti
-- =====================================================================
-- Embrulha is_admin(), auth_role() e auth.uid() em (select ...) nas policies
-- RLS do schema public, para o Postgres as avaliar UMA vez por query (InitPlan)
-- em vez de uma vez por LINHA. Puramente mecânico: nenhuma policy criada,
-- removida ou renomeada; roles e cmd preservados; nenhuma regra de acesso muda.
--
-- Conferência (feita no banco antes de gerar): removendo os embrulhos do texto
-- novo, ele é IDÊNTICO ao original em todas as 114 policies (0 divergências);
-- nenhuma chamada bruta remanescente. 77 policies mudam de texto.
--
-- Só ALTER POLICY (nunca DROP/CREATE: não pode haver janela sem policy). As
-- demais funções por-linha (my_*_companies, board_area_for_role, note_has_area,
-- note_origin_area, user_reaches_company, attendance_is_enabled) ficam como
-- estão nesta etapa. lock_timeout 3s: se não pegar o lock, falha inteira (e
-- tentamos de novo) em vez de enfileirar atrás de consultas lentas.
--
-- Reversão: supabase/rollback/0134_policies_before.sql
-- =====================================================================
ALTER POLICY al_insert ON public.activity_log WITH CHECK (((collaborator_id = (select auth.uid())) OR (select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY al_select ON public.activity_log USING (((select is_admin()) OR (collaborator_id = ( SELECT auth.uid() AS uid)) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY ae_select ON public.attendance_entries USING ((( SELECT is_admin() AS is_admin) OR ((user_id = (select auth.uid())) AND attendance_is_enabled((select auth.uid())) AND user_reaches_company((select auth.uid()), company_id))));
ALTER POLICY cpa_select ON public.client_portal_access USING ((select is_admin()));
ALTER POLICY cp_audit_select ON public.client_portal_audit USING ((select is_admin()));
ALTER POLICY companies_admin_all ON public.companies USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY companies_select ON public.companies USING (((select is_admin()) OR (id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR (id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (id IN ( SELECT my_dev_companies() AS my_dev_companies))));
ALTER POLICY ccol_admin_all ON public.company_collaborators USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY ccol_select ON public.company_collaborators USING (((select is_admin()) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = (select auth.uid()))) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY cc_admin_all ON public.company_consultants USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY cc_select ON public.company_consultants USING (((select is_admin()) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role])) AND (consultant_id = (select auth.uid())))));
ALTER POLICY ccv_admin_all ON public.company_contract_values USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY ccc_delete ON public.company_contracted_channels USING ((select is_admin()));
ALTER POLICY ccc_insert ON public.company_contracted_channels WITH CHECK ((select is_admin()));
ALTER POLICY ccc_select ON public.company_contracted_channels USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY cd_delete ON public.company_details USING ((select is_admin()));
ALTER POLICY cd_insert ON public.company_details WITH CHECK ((select is_admin()));
ALTER POLICY cd_select ON public.company_details USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY cd_update ON public.company_details USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY ce_select ON public.company_events USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY cg_delete ON public.company_groups USING ((select is_admin()));
ALTER POLICY cg_insert ON public.company_groups WITH CHECK ((select is_admin()));
ALTER POLICY cg_update ON public.company_groups USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY cl_manage ON public.company_labels USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)))) WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY cl_select ON public.company_labels USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY cna_delete ON public.company_note_areas USING ((EXISTS ( SELECT 1
   FROM company_notes n
  WHERE ((n.id = company_note_areas.note_id) AND ((select is_admin()) OR ((n.author_id = ( SELECT auth.uid() AS uid)) AND ((n.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (n.company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) OR ((n.author_id = ( SELECT auth.uid() AS uid)) AND (board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((n.company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (n.company_id IN ( SELECT my_dev_companies() AS my_dev_companies)))))))));
ALTER POLICY cna_insert ON public.company_note_areas WITH CHECK ((EXISTS ( SELECT 1
   FROM company_notes n
  WHERE ((n.id = company_note_areas.note_id) AND ((select is_admin()) OR ((n.author_id = ( SELECT auth.uid() AS uid)) AND ((n.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (n.company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) OR ((n.author_id = ( SELECT auth.uid() AS uid)) AND (board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((n.company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (n.company_id IN ( SELECT my_dev_companies() AS my_dev_companies)))))))));
ALTER POLICY cna_select ON public.company_note_areas USING ((EXISTS ( SELECT 1
   FROM company_notes n
  WHERE ((n.id = company_note_areas.note_id) AND ((select is_admin()) OR (n.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (n.company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR ((board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((n.company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (n.company_id IN ( SELECT my_dev_companies() AS my_dev_companies))) AND note_has_area(n.id, board_area_for_role(( SELECT auth_role() AS auth_role)))))))));
ALTER POLICY cnr_insert ON public.company_note_replies WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM company_notes n
  WHERE ((n.id = company_note_replies.note_id) AND ((select is_admin()) OR (n.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (n.company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR ((board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((n.company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (n.company_id IN ( SELECT my_dev_companies() AS my_dev_companies))) AND note_has_area(n.id, board_area_for_role(( SELECT auth_role() AS auth_role))))))))));
ALTER POLICY cnr_select ON public.company_note_replies USING ((EXISTS ( SELECT 1
   FROM company_notes n
  WHERE ((n.id = company_note_replies.note_id) AND ((select is_admin()) OR (n.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (n.company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR ((board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((n.company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (n.company_id IN ( SELECT my_dev_companies() AS my_dev_companies))) AND note_has_area(n.id, board_area_for_role(( SELECT auth_role() AS auth_role)))))))));
ALTER POLICY cnr_update ON public.company_note_replies USING ((author_id = (select auth.uid()))) WITH CHECK ((author_id = (select auth.uid())));
ALTER POLICY cn_delete ON public.company_notes USING (((select is_admin()) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (( SELECT auth_role() AS auth_role) = ANY (ARRAY['consultor'::user_role, 'colaborador'::user_role])))));
ALTER POLICY cn_insert ON public.company_notes WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND ((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR ((board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND (note_origin_area(origin) = board_area_for_role(( SELECT auth_role() AS auth_role))) AND ((company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (company_id IN ( SELECT my_dev_companies() AS my_dev_companies)))))));
ALTER POLICY cn_select ON public.company_notes USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR ((board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (company_id IN ( SELECT my_dev_companies() AS my_dev_companies))) AND ((note_origin_area(origin) = board_area_for_role(( SELECT auth_role() AS auth_role))) OR note_has_area(id, board_area_for_role(( SELECT auth_role() AS auth_role)))))));
ALTER POLICY cn_update ON public.company_notes USING (((select is_admin()) OR ((author_id = ( SELECT auth.uid() AS uid)) AND ((company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (company_id IN ( SELECT my_dev_companies() AS my_dev_companies))) AND note_has_area(id, board_area_for_role(( SELECT auth_role() AS auth_role)))))) WITH CHECK (((select is_admin()) OR ((author_id = ( SELECT auth.uid() AS uid)) AND ((company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (board_area_for_role(( SELECT auth_role() AS auth_role)) IS NOT NULL) AND ((company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (company_id IN ( SELECT my_dev_companies() AS my_dev_companies))) AND note_has_area(id, board_area_for_role(( SELECT auth_role() AS auth_role))))));
ALTER POLICY cra_select ON public.company_revenue_audit USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY crn_rw ON public.company_revenue_notes USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY crev_rw ON public.company_revenues USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY csc_rw ON public.company_sales_channels USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)))) WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies))));
ALTER POLICY cm_select ON public.content_mentions USING (((mentioned_user_id = (select auth.uid())) OR (select is_admin())));
ALTER POLICY cil_admin_select ON public.crm_intake_log USING ((select is_admin()));
ALTER POLICY ga_select_own ON public.google_accounts USING ((user_id = (select auth.uid())));
ALTER POLICY gcal_audit_select ON public.google_calendar_audit USING (((user_id = (select auth.uid())) OR (select is_admin())));
ALTER POLICY gcis_select_own ON public.google_calendar_import_state USING ((user_id = (select auth.uid())));
ALTER POLICY ige_select_own ON public.imported_google_events USING ((user_id = (select auth.uid())));
ALTER POLICY labels_admin_all ON public.labels USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY labels_select ON public.labels USING (((select auth.uid()) IS NOT NULL));
ALTER POLICY lb_manage ON public.listing_brands USING ((template_id IN ( SELECT task_templates.id
   FROM task_templates
  WHERE ((select is_admin()) OR (task_templates.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)))))) WITH CHECK ((template_id IN ( SELECT task_templates.id
   FROM task_templates
  WHERE ((select is_admin()) OR (task_templates.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))))));
ALTER POLICY lvr_rw ON public.listing_validation_reads USING ((user_id = (select auth.uid()))) WITH CHECK ((user_id = (select auth.uid())));
ALTER POLICY lv_insert_interno ON public.listing_validations WITH CHECK (((author_type = 'interno'::text) AND (author_id = (select auth.uid())) AND ((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (listing_result_id IN ( SELECT lr.id
   FROM (listing_results lr
     JOIN task_instances ti ON ((ti.id = lr.task_id)))
  WHERE (ti.collaborator_id = (select auth.uid()))))))));
ALTER POLICY lv_select ON public.listing_validations USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (listing_result_id IN ( SELECT lr.id
   FROM (listing_results lr
     JOIN task_instances ti ON ((ti.id = lr.task_id)))
  WHERE (ti.collaborator_id = (select auth.uid())))))));
ALTER POLICY mp_write ON public.meeting_participants USING ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_participants.meeting_id) AND (m.created_by = (select auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_participants.meeting_id) AND (m.created_by = (select auth.uid()))))));
ALTER POLICY meetings_delete ON public.meetings USING ((created_by = (select auth.uid())));
ALTER POLICY meetings_insert ON public.meetings WITH CHECK (((created_by = (select auth.uid())) AND ((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR (company_id IN ( SELECT my_collaborator_companies() AS my_collaborator_companies)) OR (company_id IN ( SELECT my_traffic_companies() AS my_traffic_companies)) OR (company_id IN ( SELECT my_dev_companies() AS my_dev_companies)))));
ALTER POLICY meetings_update ON public.meetings USING ((created_by = (select auth.uid()))) WITH CHECK ((created_by = (select auth.uid())));
ALTER POLICY notif_select ON public.notifications USING ((user_id = (select auth.uid())));
ALTER POLICY profiles_insert_self ON public.profiles WITH CHECK ((id = (select auth.uid())));
ALTER POLICY profiles_select ON public.profiles USING (((id = (select auth.uid())) OR (select is_admin()) OR (((select auth_role()) = 'consultor'::user_role) AND (role = ANY (ARRAY['colaborador'::user_role, 'admin'::user_role])))));
ALTER POLICY profiles_update_self ON public.profiles USING (((id = (select auth.uid())) OR (select is_admin()))) WITH CHECK (((select is_admin()) OR ((id = (select auth.uid())) AND (role = ( SELECT profiles_1.role
   FROM profiles profiles_1
  WHERE (profiles_1.id = (select auth.uid())))))));
ALTER POLICY st_admin_all ON public.standard_tasks USING ((select is_admin())) WITH CHECK ((select is_admin()));
ALTER POLICY st_select ON public.standard_tasks USING (((select is_admin()) OR ((select auth_role()) = 'consultor'::user_role)));
ALTER POLICY str_insert ON public.support_ticket_replies WITH CHECK (((author_id = (select auth.uid())) AND ((select auth_role()) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role, 'gestor_trafego'::user_role, 'desenvolvedor'::user_role]))));
ALTER POLICY str_select ON public.support_ticket_replies USING (((select auth_role()) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role, 'gestor_trafego'::user_role, 'desenvolvedor'::user_role])));
ALTER POLICY str_update ON public.support_ticket_replies USING ((author_id = (select auth.uid()))) WITH CHECK ((author_id = (select auth.uid())));
ALTER POLICY st_delete ON public.support_tickets USING (((select is_admin()) OR (created_by = (select auth.uid()))));
ALTER POLICY st_select ON public.support_tickets USING (((select auth_role()) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role, 'gestor_trafego'::user_role, 'desenvolvedor'::user_role])));
ALTER POLICY st_update ON public.support_tickets USING (((select auth_role()) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role, 'gestor_trafego'::user_role, 'desenvolvedor'::user_role]))) WITH CHECK (((select auth_role()) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role, 'gestor_trafego'::user_role, 'desenvolvedor'::user_role])));
ALTER POLICY ti_manage ON public.task_instances USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)))) WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY ti_select ON public.task_instances USING (((select is_admin()) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = ( SELECT auth.uid() AS uid))) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY ti_update_collaborator ON public.task_instances USING ((((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = ( SELECT auth.uid() AS uid))) OR (select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)))) WITH CHECK ((((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = ( SELECT auth.uid() AS uid))) OR (select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY tt_delete ON public.task_templates USING (((select is_admin()) OR (created_by = (select auth.uid()))));
ALTER POLICY tt_insert ON public.task_templates WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY tt_select ON public.task_templates USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = (select auth.uid())))));
ALTER POLICY tt_update ON public.task_templates USING (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies)))) WITH CHECK (((select is_admin()) OR (company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))));
ALTER POLICY ta_select ON public.time_adjustments USING (((select is_admin()) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (task_id IN ( SELECT task_instances.id
   FROM task_instances
  WHERE (task_instances.collaborator_id = (select auth.uid()))))) OR (task_id IN ( SELECT task_instances.id
   FROM task_instances
  WHERE (task_instances.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))))));
ALTER POLICY te_insert ON public.time_entries WITH CHECK (((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = (select auth.uid()))));
ALTER POLICY te_select ON public.time_entries USING (((select is_admin()) OR ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['admin'::user_role, 'consultor'::user_role, 'colaborador'::user_role])) AND (collaborator_id = (select auth.uid()))) OR (task_id IN ( SELECT task_instances.id
   FROM task_instances
  WHERE (task_instances.company_id IN ( SELECT my_consultant_companies() AS my_consultant_companies))))));
