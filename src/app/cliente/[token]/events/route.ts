import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import { CLIENT_SESSION_COOKIE } from "@/lib/client-portal";

// SSE das mensagens do PORTAL DO CLIENTE (passo 31.1).
//
// Por que SSE e não Realtime direto: o cliente não tem conta Supabase — dar a
// ele uma assinatura de banco exigiria expor credencial e abrir policy de
// leitura para anon justamente na superfície mais blindada do sistema. Aqui o
// navegador dele só fala com ESTA rota; quem consulta o banco é o servidor,
// e o escopo vem da SESSÃO validada (cookie HttpOnly + token da URL), nunca
// de parâmetro de empresa enviado pelo cliente.
//
// O stream consulta client_portal_messages_since (SECURITY DEFINER) a cada
// POLL_MS e empurra as novidades. A sessão é revalidada A CADA consulta — se
// a senha for trocada ou o acesso revogado no meio, o stream encerra na hora.
//
// Ciclo de vida: o cliente fecha a conexão ao sair/ocultar a aba (o abort
// chega pelo request.signal); um heartbeat-comentário evita que proxies matem
// a conexão ociosa; e o teto de duração da função derruba o stream de tempos
// em tempos — o EventSource reconecta sozinho (retry abaixo), e a tela
// ressincroniza por conta própria, então nada se perde.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 3_000;
const HEARTBEAT_EVERY = 7; // ~1 heartbeat a cada 21s

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(id);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

export async function GET(
  request: Request,
  { params }: { params: { token: string } }
) {
  const secret = cookies().get(CLIENT_SESSION_COOKIE)?.value ?? null;
  if (!secret || !params.token) {
    return new Response(null, { status: 401 });
  }

  const supabase = await createClient();

  // Valida a sessão ANTES de abrir o stream (sessão inválida => 401 e o
  // navegador cai na tela de senha; sem sondagem de tokens: mesma resposta
  // para token inexistente e sessão expirada).
  const url = new URL(request.url);
  const afterParam = url.searchParams.get("after");
  let after =
    afterParam && !Number.isNaN(Date.parse(afterParam))
      ? afterParam
      : new Date().toISOString();

  const probe = await supabase.rpc("client_portal_messages_since", {
    p_token: params.token,
    p_session: secret,
    p_after: after,
  });
  if (probe.error || probe.data === null) {
    return new Response(null, { status: 401 });
  }

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller já fechado (aba saiu): o loop encerra no próximo tick.
        }
      };

      // Intervalo de reconexão do EventSource quando o stream cair.
      send("retry: 3000\n\n");

      // A primeira sonda já pode ter trazido mensagens (entre o carregamento
      // da página e a conexão do stream) — entrega antes de começar o loop.
      const initial = (probe.data as { items: { at: string }[] }).items ?? [];
      if (initial.length > 0) {
        after = initial[initial.length - 1].at;
        send(`data: ${JSON.stringify(initial)}\n\n`);
      }

      let ticks = 0;
      while (!signal.aborted) {
        await sleep(POLL_MS, signal);
        if (signal.aborted) break;

        const { data, error } = await supabase.rpc(
          "client_portal_messages_since",
          { p_token: params.token, p_session: secret, p_after: after }
        );

        // Erro transitório de rede: deixa o stream cair; o EventSource
        // reconecta e a tela ressincroniza.
        if (error) break;

        // Sessão morreu no meio (senha trocada, acesso revogado): encerra em
        // definitivo — o cliente recebe "end" e NÃO deve reconectar.
        if (data === null) {
          send("event: end\ndata: sessao\n\n");
          break;
        }

        const items = (data as { items: { at: string }[] }).items ?? [];
        if (items.length > 0) {
          after = items[items.length - 1].at;
          send(`data: ${JSON.stringify(items)}\n\n`);
        }

        if (++ticks % HEARTBEAT_EVERY === 0) send(":hb\n\n");
      }

      try {
        controller.close();
      } catch {
        // já fechado
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
