import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// =====================================================================
// ⚠️ EXCEÇÃO CONTROLADA — cliente Supabase com SERVICE ROLE (ignora a RLS).
// =====================================================================
// Este projeto foi construído DE PROPÓSITO sem service_role: todo acesso passa
// pela RLS (decisão registrada na doc do módulo de Reuniões e na ESPECIFICACAO).
// Este arquivo é a ÚNICA exceção, aberta SÓ para a integração do CRM comercial
// (intake server-to-server, que não tem sessão de usuário e por isso não pode
// depender de auth.uid()/RLS).
//
// USO RESTRITO: importe `createAdminClient` APENAS nos arquivos da integração
// (src/app/api/crm/**). QUALQUER outro uso precisa de decisão explícita do dono
// do produto — não amplie o alcance por conveniência.
//
// A chave NUNCA vai ao navegador: mora em SUPABASE_SERVICE_ROLE_KEY (SEM prefixo
// NEXT_PUBLIC_). Não importe este módulo em componentes de cliente. Toda a lógica
// sensível fica em RPCs SECURITY DEFINER concedidas só ao service_role; aqui só
// chamamos essas RPCs.
// =====================================================================

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service role não configurado (defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
