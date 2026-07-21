"use server";

import { createClient } from "@/lib/supabase-server";
import { PORTAL_PROGRESS_PAGE, type PortalProgress } from "@/lib/client-portal";

// "Ver como cliente" (passo 30) — paginação do Andamento na pré-visualização.
//
// Diferença para a ação do portal: aqui NÃO existe token nem sessão de portal.
// A autorização é do usuário LOGADO e mora no banco —
// client_portal_preview_progress exige admin ou consultor da empresa e levanta
// exceção caso contrário. A action é um repasse; ela não decide nada.
//
// O conteúdo é o mesmo do portal real: as duas rotas chamam a mesma função de
// curadoria, então a pré-visualização não tem como mostrar a mais nem a menos.
export async function clientPreviewProgressPage(
  companyId: string,
  offset: number
): Promise<PortalProgress | null> {
  if (!companyId) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("client_portal_preview_progress", {
    p_company: companyId,
    p_limit: PORTAL_PROGRESS_PAGE,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  if (error) return null;
  return (data as PortalProgress | null) ?? null;
}
