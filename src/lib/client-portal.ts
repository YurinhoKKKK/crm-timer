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

// --- Mensagens no portal (passo 31) ---------------------------------------
// TEXTO PURO: `body` nunca é HTML, é escapado na exibição e não passa por
// DOMPurify — a rota do portal segue sem jsdom (passo 29). `author` é o
// primeiro nome de quem respondeu, do lado da equipe; null para o cliente.
export type PortalMessage = {
  id: string;
  body: string;
  author_type: "cliente" | "interno";
  author: string | null;
  at: string;
};

export type PortalMessages = {
  total: number;
  items: PortalMessage[];
};

export const PORTAL_MESSAGES_PAGE = 30;

// De onde o "ver mais" do Andamento puxa a próxima página. São dois caminhos
// com autorizações DIFERENTES, e por isso explicitados no tipo:
//  · portal  — sessão do cliente (token + segredo no cookie HttpOnly).
//  · preview — usuário logado, autorizado pelo cargo ("Ver como cliente").
// O conteúdo devolvido é idêntico: ambos caem na mesma curadoria no banco.
export type PortalSource =
  | { mode: "portal"; token: string }
  | { mode: "preview"; companyId: string };

// --- Gestão do acesso (passo 30) ------------------------------------------
// A gestão é EXCLUSIVA DE ADMIN. O consultor não alcança token nem senha —
// nem por tela nem por query: a policy de client_portal_access exige
// is_admin() e as funções de escrita também.

// O que o ADMIN vê do acesso. Note o que NÃO está aqui: a senha. Ela existe
// em claro uma única vez, no retorno de generateClientAccess, e nunca mais.
export type ClientAccessInfo = {
  token: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // false = senha do modelo antigo (escolhida por uma pessoa, que portanto a
  // conhece). A tela sugere trocar por uma sorteada pelo sistema.
  passwordGenerated: boolean;
  passwordSetAt: string | null;
  createdBy: string | null;
  passwordSetBy: string | null;
};

export type ClientAccessAction =
  | "criado"
  | "senha_redefinida"
  | "link_girado"
  | "revogado";

export type ClientAccessAuditEntry = {
  id: string;
  action: ClientAccessAction;
  actor: string;
  at: string;
};

export const ACCESS_ACTION_LABEL: Record<ClientAccessAction, string> = {
  criado: "Acesso criado",
  senha_redefinida: "Senha redefinida",
  link_girado: "Novo link gerado",
  revogado: "Acesso revogado",
};

// O que o CONSULTOR vê: dois booleanos, nenhuma credencial. Ele precisa saber
// se o cliente já tem portal para conduzir a relação — só isso.
export type ClientAccessStatus = { exists: boolean; active: boolean };

// Visão da central: uma coisa OU outra, conforme o cargo.
export type ClientAccessView =
  | { role: "admin"; access: ClientAccessInfo | null; audit: ClientAccessAuditEntry[] }
  | { role: "consultor"; status: ClientAccessStatus };

export function clientPortalPath(token: string): string {
  return `/cliente/${token}`;
}
