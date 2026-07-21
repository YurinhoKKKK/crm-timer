import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import ThemeToggle from "@/components/ThemeToggle";
import { getNoteSanitizer } from "@/lib/notes";
import {
  CLIENT_SESSION_COOKIE,
  PORTAL_PROGRESS_PAGE,
  type PortalData,
  type PortalProgress,
} from "@/lib/client-portal";
import ClientPortalLogin from "./ClientPortalLogin";
import PortalLogoutButton from "./PortalLogoutButton";
import PortalView from "./PortalView";

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
  // de qualquer render (DOMPurify). O client só exibe.
  // O sanitizador é carregado sob demanda (ver lib/notes) e só quando existe
  // atualização de fato — portal sem atualizações não carrega o jsdom.
  const updates =
    data.updates.length === 0
      ? []
      : await (async () => {
          const sanitize = await getNoteSanitizer();
          return data!.updates.map((u) => ({ ...u, html: sanitize(u.html) }));
        })();

  // A casca (hero + abas) é a MESMA do "Ver como cliente" (passo 30), para
  // que a pré-visualização não possa divergir do que o cliente enxerga.
  return (
    <PortalView
      companyName={data.company_name}
      listings={data.listings}
      progress={progress ?? { total: 0, items: [] }}
      updates={updates}
      source={{ mode: "portal", token: params.token }}
      actions={
        <>
          <ThemeToggle />
          <PortalLogoutButton />
        </>
      }
    />
  );
}
