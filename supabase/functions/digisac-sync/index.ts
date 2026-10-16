import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// =====================================================================
// Edge Function: digisac-sync — ETAPA 1 da sincronização Digisac.
//
// EXCEÇÃO DE service_role (2ª exceção documentada, aprovada pelo Mauricio): esta
// função usa a service_role SOMENTE aqui, e SOMENTE para gravar nas tabelas
// digisac_* e inserir a notificação de alerta (RPC digisac_alert). O código do
// site (Next) NUNCA usa service_role.
//
// Protegida por verify_jwt = false + segredo próprio DIGISAC_SYNC_SECRET, enviado
// no cabeçalho x-sync-secret e comparado em TEMPO CONSTANTE. Reusa os segredos já
// existentes DIGISAC_DOMAIN / DIGISAC_TOKEN (os mesmos do send-whatsapp).
//
// PRIVACIDADE: grava só metadados. Nunca texto, `data`, fromId/toId, telefone ou
// nome de contato. Não grava type 'ticket'/'reaction'. (A etapa 2 removeu qualquer
// leitura de texto: o antigo text_hash não existe mais.)
//
// PERFIL: o vínculo digisac_user -> perfil é feito no banco (gatilho por e-mail,
// com trava p/ ligação manual). Aqui só gravamos id/nome/e-mail do usuário.
// =====================================================================

const BUDGET_MS = 100_000; // para com folga antes do limite de execução
const PER_PAGE = 100;
const MAX_PAGES = 400; // trava por contato
const PAUSE_MS = 150;
const MAX_RETRIES = 3;
const LOOKBACK_MS = 2 * 60 * 60 * 1000; // (last_sent_at - 2h)
const SINCE_DEFAULT = "2026-09-01T03:00:00Z"; // 01/09/2026 00h BRT
const NON_MESSAGE = new Set(["ticket", "reaction"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // Compara sempre o mesmo número de bytes (comprimento do esperado) + flag de
  // tamanho, para não vazar tamanho nem sair cedo.
  let diff = ba.length ^ bb.length;
  const len = Math.max(ba.length, bb.length, 1);
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchResult = { status: number; body: any };

async function getWithBackoff(
  url: string,
  token: string,
  onRequest: () => void
): Promise<FetchResult> {
  let attempt = 0;
  for (;;) {
    attempt++;
    onRequest();
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (_e) {
      if (attempt > MAX_RETRIES) return { status: 0, body: null };
      await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
      continue;
    }
    // Auth: não adianta repetir — sinaliza para o chamador alertar e abortar.
    if (res.status === 401 || res.status === 403) {
      return { status: res.status, body: null };
    }
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      if (attempt > MAX_RETRIES) return { status: res.status, body: null };
      const ra = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(15000, 1000 * 2 ** (attempt - 1));
      await sleep(wait);
      continue;
    }
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }
}

class AuthError extends Error {}

Deno.serve(async (req) => {
  const startedMs = Date.now();

  const secret = Deno.env.get("DIGISAC_SYNC_SECRET") ?? "";
  const provided = req.headers.get("x-sync-secret") ?? "";
  if (!secret || !constantTimeEqual(provided, secret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const domain = (Deno.env.get("DIGISAC_DOMAIN") ?? "").replace(/\/+$/, "");
  const token = Deno.env.get("DIGISAC_TOKEN") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: runRow } = await supabase
    .from("digisac_sync_runs")
    .insert({ status: null })
    .select("id")
    .single();
  const runId: string | undefined = runRow?.id;

  let contactsProcessed = 0;
  let messagesUpserted = 0;
  let requests = 0;
  let status: "ok" | "parcial" | "erro" = "ok";
  let errorKind: string | null = null;
  let errorMessage: string | null = null;
  const stats = { inc: () => void requests++ };

  try {
    if (!domain || !token) throw new Error("DIGISAC_DOMAIN/DIGISAC_TOKEN ausentes");

    // ---- 1) Usuários do Digisac (id -> nome/e-mail). O vínculo com o perfil é
    //      feito no banco (gatilho digisac_users_match por e-mail, com trava p/
    //      ligação manual) — aqui NÃO mexemos em profile_id. ----
    {
      let page = 1, last = 1;
      do {
        const r = await getWithBackoff(`${domain}/api/v1/users?perPage=100&page=${page}`, token, stats.inc);
        if (r.status === 401 || r.status === 403) throw new AuthError(`Digisac ${r.status}`);
        if (r.status !== 200 || !r.body) break;
        const items: any[] = Array.isArray(r.body) ? r.body : r.body?.data ?? [];
        last = r.body?.lastPage ?? 1;
        const rows = items
          .filter((u) => u?.id != null)
          .map((u) => {
            const email = (u.email ?? "").trim();
            return {
              id: String(u.id),
              name: u.name ?? null,
              email: email || null,
              updated_at: new Date().toISOString(),
            };
          });
        if (rows.length) await supabase.from("digisac_users").upsert(rows, { onConflict: "id" });
        page++;
        await sleep(PAUSE_MS);
      } while (page <= last && page <= 20);
    }

    // ---- 2) Contatos: whatsapp_contact_id distintos das empresas ----
    const { data: comps } = await supabase
      .from("companies")
      .select("whatsapp_contact_id")
      .not("whatsapp_contact_id", "is", null);
    const contactIds = [...new Set((comps ?? []).map((c) => c.whatsapp_contact_id as string))];

    const { data: cursors } = await supabase
      .from("digisac_sync_cursor")
      .select("contact_id, last_sent_at");
    const cursorMap = new Map<string, string | null>();
    for (const c of cursors ?? []) cursorMap.set(c.contact_id, c.last_sent_at);

    // Processa primeiro os de cursor mais antigo OU nulo (nulo = nunca sincronizado).
    const sortKey = (cid: string) => {
      if (!cursorMap.has(cid)) return -1; // sem cursor → prioridade máxima
      const v = cursorMap.get(cid);
      return v ? Date.parse(v) : -1;
    };
    contactIds.sort((a, b) => sortKey(a) - sortKey(b));

    const untilIso = new Date().toISOString();

    for (const cid of contactIds) {
      if (Date.now() - startedMs > BUDGET_MS) { status = "parcial"; break; }

      const cur = cursorMap.get(cid);
      const sinceIso = cur
        ? new Date(Date.parse(cur) - LOOKBACK_MS).toISOString()
        : SINCE_DEFAULT;

      let page = 1;
      let last = 1;
      let contactBudgetHit = false;
      do {
        if (Date.now() - startedMs > BUDGET_MS) { status = "parcial"; contactBudgetHit = true; break; }

        const url =
          `${domain}/api/v1/messages?where[contactId]=${encodeURIComponent(cid)}` +
          `&where[timestamp][$gte]=${encodeURIComponent(sinceIso)}` +
          `&where[timestamp][$lte]=${encodeURIComponent(untilIso)}` +
          `&perPage=${PER_PAGE}&page=${page}`;
        const r = await getWithBackoff(url, token, stats.inc);
        if (r.status === 401 || r.status === 403) throw new AuthError(`Digisac ${r.status}`);
        if (r.status !== 200 || !r.body) break; // backoff esgotado → pula o contato

        const items: any[] = r.body?.data ?? [];
        last = r.body?.lastPage ?? 1;

        const rows: any[] = [];
        let pageMaxSent: number | null = null;
        for (const m of items) {
          const type = m.type == null ? "" : String(m.type);
          if (NON_MESSAGE.has(type)) continue;
          const ts = m.timestamp ?? m.createdAt;
          const sentMs = ts ? Date.parse(ts) : NaN;
          if (!Number.isFinite(sentMs)) continue;

          rows.push({
            id: String(m.id),
            contact_id: cid,
            ticket_id: m.ticketId ?? null,
            digisac_user_id: m.userId ?? null,
            is_from_me: m.isFromMe ?? null,
            is_from_bot: m.isFromBot ?? null,
            is_comment: m.isComment ?? null,
            visible: m.visible ?? null,
            origin: m.origin ?? null,
            type,
            sent_at: new Date(sentMs).toISOString(),
          });
          if (pageMaxSent === null || sentMs > pageMaxSent) pageMaxSent = sentMs;
        }

        if (rows.length) {
          const { error } = await supabase
            .from("digisac_messages")
            .upsert(rows, { onConflict: "id" });
          if (error) break; // registra no run (parcial/ok) e segue; não derruba tudo
          messagesUpserted += rows.length;

          // Cursor só APÓS gravar a página com sucesso.
          if (pageMaxSent !== null) {
            await supabase.from("digisac_sync_cursor").upsert(
              {
                contact_id: cid,
                last_sent_at: new Date(pageMaxSent).toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "contact_id" }
            );
            const prev = cursorMap.get(cid);
            if (!prev || pageMaxSent > Date.parse(prev)) {
              cursorMap.set(cid, new Date(pageMaxSent).toISOString());
            }
          }
        }

        page++;
        await sleep(PAUSE_MS);
      } while (page <= last && page <= MAX_PAGES);

      contactsProcessed++;
      if (contactBudgetHit) break;
    }
  } catch (e) {
    status = "erro";
    if (e instanceof AuthError) {
      errorKind = "auth";
      errorMessage = e.message.slice(0, 300);
      await supabase.rpc("digisac_alert", {
        p_type: "digisac_sync_auth",
        p_title: "Sincronização do Digisac falhou: token inválido ou vencido",
      });
    } else {
      errorKind = "geral";
      errorMessage = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await supabase.rpc("digisac_alert", {
        p_type: "digisac_sync_error",
        p_title: "Sincronização do Digisac falhou: " + (errorMessage ?? "erro"),
      });
    }
  }

  if (runId) {
    await supabase
      .from("digisac_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        contacts_processed: contactsProcessed,
        messages_upserted: messagesUpserted,
        requests,
        error_kind: errorKind,
        error_message: errorMessage,
      })
      .eq("id", runId);
  }

  return json(
    { status, contactsProcessed, messagesUpserted, requests },
    status === "erro" ? 500 : 200
  );
});
