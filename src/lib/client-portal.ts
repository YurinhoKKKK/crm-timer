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

// Aba "Andamento" (passo 25.1) — formato devolvido por client_portal_progress.
// Estado JÁ CURADO no banco ('em_andamento' | 'entregue'); done_on é SÓ a
// data (YYYY-MM-DD, fuso de Brasília), calculada no SQL — hora, tempo, prazo
// e responsável nunca saem do banco.
export type PortalProgressItem = {
  title: string;
  state: "em_andamento" | "entregue";
  done_on: string | null;
};

export type PortalProgress = {
  total: number;
  items: PortalProgressItem[];
};

// Página do feed (paginação no servidor — o portal nunca carrega tudo).
export const PORTAL_PROGRESS_PAGE = 20;

// Estado do acesso, para a gestão interna (admin/consultor na central).
export type ClientAccessInfo = {
  token: string;
  active: boolean;
  updatedAt: string;
};

export function clientPortalPath(token: string): string {
  return `/cliente/${token}`;
}
