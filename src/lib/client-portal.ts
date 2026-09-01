import type { ListingMarketplace } from "@/lib/types";

// Portal do cliente (passo 25) — contratos compartilhados entre as ações,
// a página pública e a gestão interna.

// Cookie HttpOnly com o segredo da sessão do cliente (hash fica no banco).
export const CLIENT_SESSION_COOKIE = "mv_client_session";

// Veredito do cliente sobre uma listagem (passo 33) — o ESTADO ATUAL, derivado
// do último evento em listing_validations. `by` distingue cliente × interno
// (ex.: "cliente aprovou por telefone" registrado pela equipe).
export type ListingValidationState = {
  // 'reajuste_feito' é INTERNO (a equipe sinalizou que refez o pedido); o
  // cliente nunca o envia — só reconfirma (aprovar/solicitar ajuste).
  event: "aprovado" | "ajuste_solicitado" | "contestado" | "reajuste_feito";
  comment: string | null;
  by: "cliente" | "interno";
  at: string;
};

// Formato devolvido por client_portal_data (jsonb): SÓ o conteúdo curado.
// Cada listagem tem OU o link publicado OU a justificativa de não feita
// (constraint link_xor_reason no banco) — o cliente vê os dois casos. `id` é o
// listing_results.id, que o cliente referencia ao registrar uma validação.
export type PortalListing = {
  id: string;
  brand: string;
  marketplace: ListingMarketplace;
  link: string | null;
  reason: string | null;
  date: string | null;
  validation: ListingValidationState | null;
};

export type ListingValidationEvent =
  | "aprovado"
  | "ajuste_solicitado"
  | "contestado";

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

// --- Reuniões no portal (portal do cliente · aba Reuniões) -----------------
// Formato devolvido por client_portal_meetings — SÓ o conteúdo curado. Sem
// participantes, descrição, criador, status de sincronização ou qualquer campo
// interno: eles não saem do banco (a função de payload não os seleciona).
// `meet_link` vem APENAS nas PRÓXIMAS e do tipo online ('meet'); nas anteriores
// nunca (o backend não o envia).
export type PortalMeetingType =
  | "meet"
  | "presencial_escritorio"
  | "presencial_cliente";

export type PortalMeeting = {
  title: string;
  starts_at: string; // ISO (UTC) — formatado em BRT na exibição
  ends_at: string; // ISO (UTC)
  type: PortalMeetingType;
  meet_link?: string | null;
};

// Anteriores são paginadas (o histórico cresce); próximas vêm inteiras.
export type PortalPastMeetings = { total: number; items: PortalMeeting[] };

export type PortalMeetings = {
  upcoming: PortalMeeting[];
  past: PortalPastMeetings;
};

export const PORTAL_MEETINGS_PAGE = 20;

// Rótulos em LINGUAGEM DO CLIENTE (não os internos). Constante local do portal
// para manter a tela self-contained — nada de reusar componentes internos.
export const PORTAL_MEETING_TYPE_LABEL: Record<PortalMeetingType, string> = {
  meet: "Online",
  presencial_escritorio: "Presencial · escritório Monvatti",
  presencial_cliente: "Presencial · na sua empresa",
};

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
