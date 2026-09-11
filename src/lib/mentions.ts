// Tipos e utilidades PURAS de menção (@usuário). Sem "use server" e sem
// dependência de servidor: pode ser importado tanto pelo editor (cliente)
// quanto pelas server actions.

// Os quatro contextos onde a menção vale. Espelha o CHECK de content_mentions
// (migration 0076) e o parâmetro das RPCs mentionable_users/sync_content_mentions.
export type MentionSourceType =
  | "atualizacao"
  | "atualizacao_resposta"
  | "chamado"
  | "chamado_resposta";

// Contexto passado ao editor para habilitar o @: o tipo da fonte e a empresa
// (nula em chamado, que é visível a toda a equipe).
export type MentionContext = {
  sourceType: MentionSourceType;
  companyId: string | null;
};

// Uma pessoa que PODE ser marcada naquele contexto (já filtrada no servidor).
export type MentionUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extrai os ids de usuário marcados a partir do HTML SALVO. Roda no servidor,
// sobre o conteúdo autoritativo (nunca sobre uma lista vinda do navegador): cada
// menção é um <span data-type="mention" data-id="<uuid>" …>. A validação de
// acesso acontece depois, na RPC sync_content_mentions. Ordem de atributos é
// tolerada (procura data-id dentro de um span marcado como menção).
export function extractMentionIds(html: string): string[] {
  const ids = new Set<string>();
  const spanRe = /<span\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(html)) !== null) {
    const tag = m[0];
    if (!/data-type\s*=\s*["']mention["']/i.test(tag)) continue;
    const idMatch = tag.match(/data-id\s*=\s*["']([^"']+)["']/i);
    if (idMatch && UUID_RE.test(idMatch[1])) ids.add(idMatch[1].toLowerCase());
  }
  return Array.from(ids);
}
