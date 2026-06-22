import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Edge Function: send-whatsapp
// Envia o resumo de uma tarefa ao grupo de WhatsApp da empresa, via Digisac.
//
// Recebe { companyId, message }. Busca o whatsapp_contact_id da empresa
// (com a service role, para não depender da RLS do chamador) e dispara a
// mensagem ao grupo. Exige um JWT válido do Supabase (verify_jwt = true),
// então só usuários autenticados conseguem chamar.
//
// IMPORTANTE: usa contactId (ID interno do contato/grupo na Digisac), NÃO o
// number com @g.us — a API confunde com contato individual.
//
// Secrets esperados (configure com `supabase secrets set`, NUNCA no código):
//   - DIGISAC_DOMAIN      ex: https://suaempresa.digisac.app
//   - DIGISAC_TOKEN       token Bearer da API
//   - DIGISAC_SERVICE_ID  id do serviço/canal usado para enviar
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  if (req.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }

  const domain = Deno.env.get("DIGISAC_DOMAIN");
  const token = Deno.env.get("DIGISAC_TOKEN");
  const serviceId = Deno.env.get("DIGISAC_SERVICE_ID");

  if (!domain || !token || !serviceId) {
    return json(
      {
        error:
          "DIGISAC_DOMAIN, DIGISAC_TOKEN e DIGISAC_SERVICE_ID não configurados.",
      },
      500
    );
  }

  let companyId: string | undefined;
  let message: string | undefined;
  try {
    const body = await req.json();
    companyId = body?.companyId;
    message = typeof body?.message === "string" ? body.message.trim() : undefined;
  } catch {
    return json({ error: "Corpo inválido (esperado JSON)." }, 400);
  }

  if (!companyId || !message) {
    return json({ error: "companyId e message são obrigatórios." }, 400);
  }

  // Busca o contactId do grupo com a service role.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: company, error: dbErr } = await admin
    .from("companies")
    .select("whatsapp_contact_id, whatsapp_group_name")
    .eq("id", companyId)
    .single();

  if (dbErr) {
    return json({ error: `Empresa não encontrada: ${dbErr.message}` }, 404);
  }
  if (!company?.whatsapp_contact_id) {
    return json(
      {
        error:
          "Esta empresa não tem um grupo de WhatsApp vinculado. Vincule um grupo no cadastro da empresa antes de enviar.",
      },
      422
    );
  }

  const base = domain.replace(/\/+$/, ""); // remove barra final

  try {
    const res = await fetch(`${base}/api/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: message,
        contactId: company.whatsapp_contact_id,
        serviceId,
        origin: "bot",
        dontOpenTicket: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return json(
        { error: `Digisac respondeu ${res.status}: ${text.slice(0, 300)}` },
        502
      );
    }

    const data = await res.json().catch(() => ({}));
    return json({ ok: true, group: company.whatsapp_group_name ?? null, data });
  } catch (err) {
    return json(
      { error: `Falha ao enviar pela Digisac: ${String(err)}` },
      502
    );
  }
});
