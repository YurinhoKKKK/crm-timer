import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import Logo from "@/components/Logo";
import { marketplaceLabel } from "@/lib/listing";
import { sanitizeNoteHtml } from "@/lib/notes";
import {
  CLIENT_SESSION_COOKIE,
  type PortalData,
  type PortalListing,
} from "@/lib/client-portal";
import ClientPortalLogin from "./ClientPortalLogin";
import PortalLogoutButton from "./PortalLogoutButton";

// Página com token na URL: nunca indexar nem seguir.
export const metadata: Metadata = {
  title: "Portal do cliente — Monvatti",
  robots: { index: false, follow: false },
};

// PORTAL DO CLIENTE (passo 25) — tela SEPARADA e curada, sem AppShell, sem
// menu, sem navegação para o sistema interno. Tudo que ela consegue ler vem
// de client_portal_data (SECURITY DEFINER), que deriva a empresa da SESSÃO
// validada e devolve apenas: nome da empresa, listagens entregues (com link)
// e anotações marcadas "visível ao cliente". Nada de tarefas, tempo, atrasos,
// colaboradores ou progresso — por construção, não há query para isso aqui.
export default async function ClientePortalPage({
  params,
}: {
  params: { token: string };
}) {
  const secret = cookies().get(CLIENT_SESSION_COOKIE)?.value ?? null;

  let data: PortalData | null = null;
  if (secret) {
    const supabase = await createClient();
    const { data: raw } = await supabase.rpc("client_portal_data", {
      p_token: params.token,
      p_session: secret,
    });
    data = (raw as PortalData | null) ?? null;
  }

  // Sem sessão válida PARA ESTE token (expirada, revogada ou de outra
  // empresa): tela de senha. Não revela nada — nem o nome da empresa.
  if (!data) {
    return <ClientPortalLogin token={params.token} />;
  }

  // Listagens agrupadas por marca (entrega mais recente primeiro).
  const byBrand = new Map<string, PortalListing[]>();
  for (const l of data.listings) {
    const list = byBrand.get(l.brand) ?? [];
    list.push(l);
    byBrand.set(l.brand, list);
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Cabeçalho acolhedor */}
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Logo variant="auto" className="h-9 w-auto max-w-[180px]" />
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Portal do cliente
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
              {data.company_name}
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
              Bem-vindo! Aqui você acompanha as entregas e as novidades do seu
              projeto com a Monvatti.
            </p>
          </div>
          <PortalLogoutButton />
        </header>

        {/* Entrega principal: listagens nos marketplaces */}
        <section className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="font-semibold text-fg">Suas listagens nos marketplaces</h2>
          <p className="mt-1 text-sm text-fg-muted">
            As marcas do seu catálogo em cada marketplace: o link da
            publicação ou, quando não publicada, o motivo.
          </p>
          {byBrand.size === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-line bg-surface-2/40 p-6 text-center text-sm text-fg-subtle">
              As listagens do seu projeto aparecerão aqui assim que forem
              publicadas.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {Array.from(byBrand.entries()).map(([brand, rows]) => (
                <div
                  key={brand}
                  className="rounded-xl border border-line bg-surface-2/40 p-4"
                >
                  <p className="font-medium text-fg">{brand}</p>
                  <ul className="mt-2 divide-y divide-line/60">
                    {rows.map((r, i) => (
                      <li
                        key={`${r.marketplace}-${i}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg-muted">
                          {marketplaceLabel(r.marketplace)}
                        </span>
                        {r.link ? (
                          <a
                            href={r.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 break-all text-risd underline decoration-risd/40 underline-offset-2 hover:decoration-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                          >
                            {r.link}
                          </a>
                        ) : (
                          <span className="min-w-0 text-fg-subtle">
                            Não publicada
                            {r.reason ? (
                              <>
                                {" "}
                                — <span className="italic text-fg-muted">{r.reason}</span>
                              </>
                            ) : null}
                          </span>
                        )}
                        {r.date && (
                          <span className="ml-auto text-xs text-fg-subtle">
                            {formatDate(r.date)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Comunicação curada: só anotações "visível ao cliente" */}
        <section className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="font-semibold text-fg">Atualizações do projeto</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Resumos de reunião, planos de ação e novidades compartilhados pela
            equipe.
          </p>
          {data.updates.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-line bg-surface-2/40 p-6 text-center text-sm text-fg-subtle">
              Nenhuma atualização publicada ainda.
            </p>
          ) : (
            <ol className="mt-5 space-y-5">
              {data.updates.map((u) => (
                <li
                  key={u.id}
                  className="rounded-xl border border-line bg-surface-2/40 p-4"
                >
                  <p className="mb-2 text-xs font-medium text-fg-subtle">
                    {formatDate(u.at)}
                  </p>
                  <div
                    className="rich-text"
                    // Sanitizado no servidor (sanitizeNoteHtml/DOMPurify).
                    dangerouslySetInnerHTML={{
                      __html: sanitizeNoteHtml(u.html),
                    }}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="pb-4 text-center text-xs text-fg-subtle">
          Monvatti · acesso exclusivo do cliente
        </footer>
      </div>
    </main>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
