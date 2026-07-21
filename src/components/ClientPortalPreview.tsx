import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import ThemeToggle from "@/components/ThemeToggle";
import PortalView from "@/app/cliente/[token]/PortalView";
import { getNoteSanitizer } from "@/lib/notes";
import {
  PORTAL_PROGRESS_PAGE,
  type PortalData,
  type PortalProgress,
} from "@/lib/client-portal";

// "VER COMO CLIENTE" (passo 30) — pré-visualização autenticada e somente
// leitura da tela do cliente, aberta pela PRÓPRIA CONTA do usuário.
//
// GARANTIAS:
//  · Não usa e não revela token nem senha. Um consultor pode conferir o que o
//    cliente vê sem nunca alcançar a credencial (que, desde o passo 30, é
//    exclusiva do admin).
//  · Não cria sessão de portal: nenhum cookie, nenhuma linha em
//    client_portal_sessions. Sair daqui é só navegar de volta.
//  · A autorização mora no BANCO: client_portal_preview exige admin ou
//    consultor DAQUELA empresa e levanta exceção caso contrário. Trocar o id
//    na URL não abre a empresa de outro consultor.
//  · SOMENTE LEITURA: esta tela não oferece nenhuma ação de escrita.
//  · O conteúdo vem da MESMA função de curadoria do portal real
//    (client_portal_payload), então o preview não mostra a mais nem a menos.
export default async function ClientPortalPreview({
  companyId,
  backHref,
  backLabel,
}: {
  companyId: string;
  backHref: string;
  backLabel: string;
}) {
  const supabase = await createClient();

  const [dataRes, progressRes] = await Promise.all([
    supabase.rpc("client_portal_preview", { p_company: companyId }),
    supabase.rpc("client_portal_preview_progress", {
      p_company: companyId,
      p_limit: PORTAL_PROGRESS_PAGE,
      p_offset: 0,
    }),
  ]);

  // Sem permissão (o banco recusou) ou empresa inexistente: 404, sem revelar
  // se a empresa existe.
  const data = (dataRes.data as PortalData | null) ?? null;
  if (dataRes.error || !data?.company_name) notFound();
  const progress = (progressRes.data as PortalProgress | null) ?? {
    total: 0,
    items: [],
  };

  // Mesmo ponto único de sanitização do portal real, e igualmente preguiçoso:
  // sem atualizações, o jsdom não é carregado (passo 29).
  const updates =
    data.updates.length === 0
      ? []
      : await (async () => {
          const sanitize = await getNoteSanitizer();
          return data.updates.map((u) => ({ ...u, html: sanitize(u.html) }));
        })();

  return (
    <PortalView
      companyName={data.company_name}
      listings={data.listings}
      progress={progress}
      updates={updates}
      source={{ mode: "preview", companyId }}
      banner={
        <div className="border-b border-line bg-surface-2">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <p className="text-xs font-medium text-fg-muted">
              Pré-visualização — é isto que o cliente vê.
            </p>
            <Link
              href={backHref}
              className="text-xs font-semibold text-risd underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              Sair da pré-visualização
            </Link>
          </div>
        </div>
      }
      actions={
        <>
          <ThemeToggle />
          <Link
            href={backHref}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            {backLabel}
          </Link>
        </>
      }
    />
  );
}
