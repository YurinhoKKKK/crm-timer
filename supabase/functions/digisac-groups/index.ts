import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: digisac-groups
// Lista os grupos de WhatsApp da Digisac para o dropdown de cadastro de empresa.
//
// A API da Digisac pagina de 15 em 15 e IGNORA o parâmetro `limit`, então
// varremos as páginas (page=1, 2, ...) até cobrir todos os grupos.
//
// Secrets esperados (configure com `supabase secrets set`, NUNCA no código):
//   - DIGISAC_DOMAIN  ex: https://suaempresa.digisac.app
//   - DIGISAC_TOKEN   token Bearer da API

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Group = { id: string; name: string; number: string | null };

const PER_PAGE = 15;
const MAX_PAGES = 100; // trava de segurança contra loop infinito

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const domain = Deno.env.get("DIGISAC_DOMAIN");
  const token = Deno.env.get("DIGISAC_TOKEN");

  if (!domain || !token) {
    return json(
      { error: "DIGISAC_DOMAIN e DIGISAC_TOKEN não configurados." },
      500
    );
  }

  const base = domain.replace(/\/+$/, ""); // remove barra final
  const groups: Group[] = [];

  try {
    let page = 1;
    let lastPage = Infinity;

    while (page <= lastPage && page <= MAX_PAGES) {
      const url = `${base}/api/v1/contacts?type=group&page=${page}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const text = await res.text();
        return json(
          { error: `Digisac respondeu ${res.status}: ${text.slice(0, 300)}` },
          502
        );
      }

      const body = await res.json();
      // A resposta pode vir como array direto ou como { data, lastPage, ... }.
      const items: any[] = Array.isArray(body) ? body : body?.data ?? [];

      for (const c of items) {
        groups.push({
          id: c.id,
          name: c.name ?? "(sem nome)",
          number: c?.data?.number ?? null,
        });
      }

      if (typeof body?.lastPage === "number") {
        lastPage = body.lastPage;
      } else if (items.length < PER_PAGE) {
        break; // página incompleta = última página
      }

      if (items.length === 0) break;
      page++;
    }

    groups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return json({ groups });
  } catch (err) {
    return json(
      { error: `Falha ao consultar a Digisac: ${String(err)}` },
      502
    );
  }
});
