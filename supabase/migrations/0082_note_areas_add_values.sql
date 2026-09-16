-- =====================================================================
-- CRM/Timer - Monvatti :: novas ÁREAS de atualização (note_area)
-- =====================================================================
-- Amplia a taxonomia de áreas das atualizações (company_notes) com três áreas
-- de TIME, além dos marketplaces/ERP/site/tráfego já existentes na 0074:
--   - cs          → Customer Success (relacionamento/suporte ao cliente)
--   - comercial   → time comercial (vendas)
--   - diagnostico → diagnóstico/análise inicial
--
-- IDEMPOTENTE (add value if not exists): os valores já existem em produção
-- (foram adicionados direto no banco); este arquivo apenas fixa a mudança no
-- histórico de migrations para que um ambiente NOVO reproduza o mesmo enum.
-- A ordem segue a de produção (cs, comercial, diagnostico) para o enum ficar
-- idêntico em qualquer ambiente.
--
-- Continua valendo o princípio da 0074: note_area é taxonomia PRÓPRIA, separada
-- de sales_channel (faturamento) e listing_marketplace (listagens).
-- =====================================================================

alter type note_area add value if not exists 'cs';
alter type note_area add value if not exists 'comercial';
alter type note_area add value if not exists 'diagnostico';
