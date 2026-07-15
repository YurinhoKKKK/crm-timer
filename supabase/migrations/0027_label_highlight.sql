-- =====================================================================
-- CRM/Timer - Monvatti :: Etiqueta em destaque
-- =====================================================================
-- Adiciona o "tamanho" da etiqueta: highlight = true faz o chip renderizar
-- maior e mais chamativo (fonte/padding maiores + halo na cor da etiqueta)
-- em todos os lugares onde ele aparece (empresas, tarefas, listas). É só
-- apresentação — nenhuma regra de negócio depende disso.
-- =====================================================================

alter table labels
  add column if not exists highlight boolean not null default false;
