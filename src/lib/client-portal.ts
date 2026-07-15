import type { ListingMarketplace } from "@/lib/types";

// Portal do cliente (passo 25) — contratos compartilhados entre as ações,
// a página pública e a gestão interna.

// Cookie HttpOnly com o segredo da sessão do cliente (hash fica no banco).
export const CLIENT_SESSION_COOKIE = "mv_client_session";

// Formato devolvido por client_portal_data (jsonb): SÓ o conteúdo curado.
// Cada listagem tem OU o link publicado OU a justificativa de não feita
// (constraint link_xor_reason no banco) — o cliente vê os dois casos.
export type PortalListing = {
  brand: string;
  marketplace: ListingMarketplace;
  link: string | null;
  reason: string | null;
  date: string | null;
};

export type PortalUpdate = {
  id: string;
  html: string;
  at: string;
};

export type PortalData = {
  company_name: string;
  listings: PortalListing[];
  updates: PortalUpdate[];
};

// Estado do acesso, para a gestão interna (admin/consultor na central).
export type ClientAccessInfo = {
  token: string;
  active: boolean;
  updatedAt: string;
};

export function clientPortalPath(token: string): string {
  return `/cliente/${token}`;
}
