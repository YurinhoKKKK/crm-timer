import type { createClient } from "@/lib/supabase-server";
import { resolvePeople } from "@/lib/creator";

// Mensagens cliente ↔ equipe (passo 31), lado INTERNO.
//
// O lado do cliente não passa por aqui: ele lê e escreve por funções
// SECURITY DEFINER escopadas à empresa da sessão do portal. Aqui é a leitura
// autenticada, escopada pela RLS de company_messages (admin em todas;
// consultor nas dele; colaborador nas em que tem tarefa).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export const MESSAGES_PAGE = 30;

export type CompanyMessage = {
  id: string;
  body: string;
  authorType: "cliente" | "interno";
  // Quem respondeu, do lado da equipe. null quando é o cliente (ele não tem
  // conta) — a tela rotula essas mensagens com o nome da empresa, que é
  // assunto de apresentação, não da consulta.
  authorName: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
};

export type CompanyMessagePage = {
  items: CompanyMessage[];
  total: number;
};

export async function loadCompanyMessages(
  supabase: SupabaseServer,
  companyId: string,
  offset = 0
): Promise<CompanyMessagePage> {
  // Busca as MAIS RECENTES e reordena para exibir em ordem cronológica — é
  // assim que a paginação "ver mais" cresce para trás sem recarregar tudo.
  const { data, count } = await supabase
    .from("company_messages")
    .select("id, body, author_type, author_id, created_at", { count: "exact" })
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .range(offset, offset + MESSAGES_PAGE - 1);

  const rows = ((data ?? []) as {
    id: string;
    body: string;
    author_type: "cliente" | "interno";
    author_id: string | null;
    created_at: string;
  }[]).reverse();

  // Nome e foto de quem respondeu, em UMA chamada em lote. Via
  // display_profiles porque a RLS de profiles não deixa todo cargo ler todo
  // perfil — um join direto devolveria null silenciosamente (ver passo 29).
  const people = await resolvePeople(
    supabase,
    rows.map((r) => r.author_id)
  );

  const items: CompanyMessage[] = rows.map((r) => {
    const person = r.author_id ? people.get(r.author_id) : undefined;
    return {
      id: r.id,
      body: r.body,
      authorType: r.author_type,
      authorName:
        r.author_type === "cliente" ? null : (person?.name ?? "Equipe"),
      authorAvatarUrl: person?.avatarUrl ?? null,
      createdAt: r.created_at,
    };
  });

  return { items, total: count ?? items.length };
}
