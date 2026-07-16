import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { sanitizeNoteHtml } from "@/lib/notes";
import {
  CLIENT_SESSION_COOKIE,
  PORTAL_PROGRESS_PAGE,
  type PortalData,
  type PortalProgress,
} from "@/lib/client-portal";
import ClientPortalLogin from "./ClientPortalLogin";
import PortalLogoutButton from "./PortalLogoutButton";
import PortalContent from "./PortalContent";

// Página com token na URL: nunca indexar nem seguir.
export const metadata: Metadata = {
  title: "Portal do cliente — Monvatti",
  robots: { index: false, follow: false },
};

// PORTAL DO CLIENTE (passo 25) — tela SEPARADA e curada, sem AppShell, sem
// menu, sem navegação para o sistema interno. Tudo que ela consegue ler vem
// de client_portal_data (SECURITY DEFINER), que deriva a empresa da SESSÃO
// validada e devolve apenas: nome da empresa, listagens entregues (com link
// ou com o motivo) e anotações marcadas "visível ao cliente". Nada de
// tarefas, tempo, atrasos, colaboradores ou progresso — por construção, não
// há query para isso aqui.
export default async function ClientePortalPage({
  params,
}: {
  params: { token: string };
}) {
  const secret = cookies().get(CLIENT_SESSION_COOKIE)?.value ?? null;

  let data: PortalData | null = null;
  let progress: PortalProgress | null = null;
  if (secret) {
    const supabase = await createClient();
    // Conteúdo + primeira página do Andamento (paginado no servidor), ambos
    // derivados da MESMA sessão validada — nenhuma outra fonte de dados.
    const [dataRes, progressRes] = await Promise.all([
      supabase.rpc("client_portal_data", {
        p_token: params.token,
        p_session: secret,
      }),
      supabase.rpc("client_portal_progress", {
        p_token: params.token,
        p_session: secret,
        p_limit: PORTAL_PROGRESS_PAGE,
        p_offset: 0,
      }),
    ]);
    data = (dataRes.data as PortalData | null) ?? null;
    progress = (progressRes.data as PortalProgress | null) ?? null;
  }

  // Sem sessão válida PARA ESTE token (expirada, revogada ou de outra
  // empresa): tela de senha. Não revela nada — nem o nome da empresa.
  if (!data) {
    return <ClientPortalLogin token={params.token} />;
  }

  // Ponto ÚNICO de sanitização do HTML das atualizações: no servidor, antes
  // de qualquer render (sanitizeNoteHtml/DOMPurify). O client só exibe.
  const updates = data.updates.map((u) => ({
    ...u,
    html: sanitizeNoteHtml(u.html),
  }));

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {/* Barra superior: logo + ações (tema e sair) */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <Logo variant="auto" className="h-8 w-auto max-w-[160px]" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <PortalLogoutButton />
          </div>
        </div>

        {/* Hero de boas-vindas com o gradiente da marca */}
        <header className="portal-hero relative mb-8 overflow-hidden rounded-2xl p-6 shadow-pop sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 -left-12 h-56 w-56 rounded-full bg-white/[0.07] blur-2xl"
          />
          <p className="relative text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
            Portal do cliente
          </p>
          <h1 className="relative mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {data.company_name}
          </h1>
          <p className="relative mt-3 max-w-xl text-sm leading-relaxed text-white/85">
            Bem-vindo! Aqui você acompanha as entregas e as novidades do seu
            projeto com a Monvatti.
          </p>
        </header>

        {/* Conteúdo em abas: Listagens, Andamento (se houver) e Atualizações */}
        <PortalContent
          token={params.token}
          listings={data.listings}
          progress={progress ?? { total: 0, items: [] }}
          updates={updates}
        />

        <footer className="mt-8 pb-4 text-center text-xs text-fg-subtle">
          Monvatti · acesso exclusivo do cliente
        </footer>
      </div>
    </main>
  );
}
