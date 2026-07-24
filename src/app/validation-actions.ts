"use server";

import { createClient } from "@/lib/supabase-server";

// Fila e leitura das VALIDAÇÕES de listagem (passo 33), lado interno. Tudo passa
// pela RLS lv_select (SECURITY INVOKER no banco): admin vê todas; consultor as
// empresas dele; COLABORADOR só as listagens sob responsabilidade dele. Nenhum
// caminho aqui amplia o acesso — só reagrupa o que o cargo já pode ler.

export type ValidationQueueRow = {
  companyId: string;
  companyName: string;
  listingResultId: string;
  taskId: string;
  brand: string;
  marketplace: string;
  link: string | null;
  eventType: "ajuste_solicitado" | "contestado";
  comment: string | null;
  at: string;
};

type RawRow = {
  company_id: string;
  company_name: string;
  listing_result_id: string;
  task_id: string;
  brand: string;
  marketplace: string;
  link: string | null;
  event_type: "ajuste_solicitado" | "contestado";
  comment: string | null;
  at: string;
};

export async function fetchValidationQueue(): Promise<ValidationQueueRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase.rpc("listing_validation_queue");
  return ((data as RawRow[] | null) ?? []).map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    listingResultId: r.listing_result_id,
    taskId: r.task_id,
    brand: r.brand,
    marketplace: r.marketplace,
    link: r.link,
    eventType: r.event_type,
    comment: r.comment,
    at: r.at,
  }));
}

// Marca todas as validações como vistas por este usuário (zera a parte de
// validações do badge). A FILA de itens em aberto continua aparecendo.
export async function markValidationsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc("mark_validations_read");
}
