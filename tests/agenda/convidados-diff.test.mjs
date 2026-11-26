// Testa o diff de convidados do updateMeeting REAL (B16): quem fica não é
// recriado (preserva o response espelhado e não dispara convite de novo); só
// remove quem saiu e insere quem entrou. Google neutralizado em "nao_conectado"
// — nada de rede. Rodar: node --test tests/agenda/
import test from "node:test";
import assert from "node:assert/strict";
import { loadServerModule, mockSupabase } from "./harness.mjs";

class GoogleError extends Error {}
class EventGone extends Error {}

// O createClient do stub devolve o client do teste corrente.
let currentClient = null;

const actions = loadServerModule("src/app/meeting-actions.ts", {
  "@/lib/supabase-server": { createClient: async () => currentClient },
  "@/lib/google-calendar": {
    getValidAccessToken: async () => ({ status: "nao_conectado" }),
    insertCalendarEvent: async () => {
      throw new Error("não deveria falar com o Google neste teste");
    },
    patchCalendarEvent: async () => {
      throw new Error("não deveria falar com o Google neste teste");
    },
    deleteCalendarEvent: async () => {
      throw new Error("não deveria falar com o Google neste teste");
    },
    getCalendarEvent: async () => {
      throw new Error("não deveria falar com o Google neste teste");
    },
    setMyResponseStatus: async () => {
      throw new Error("não deveria falar com o Google neste teste");
    },
    EventGone,
  },
  "@/lib/google-oauth": { GoogleError },
  "@/lib/meetings": { loadAgendaItems: async () => [] },
  "@/lib/rooms": { roomCalendarEmail: () => null },
});

const USER = { id: "u1" };

const INPUT = {
  meetingId: "m1",
  companyId: "c1",
  companyName: "Empresa X",
  title: "Alinhamento",
  description: "",
  type: "meet",
  room: null,
  startISO: "2026-12-01T13:00:00.000Z",
  endISO: "2026-12-01T14:00:00.000Z",
  participantIds: [],
};

function clientFor(responses) {
  const mock = mockSupabase({ user: USER, responses });
  currentClient = mock.client;
  return mock;
}

test("edição: mantém quem fica, remove só quem saiu, insere só quem entrou (dedupe)", async () => {
  const { ops } = clientFor({
    "meetings:select": [
      { data: { created_by: "u1", google_event_id: "evt1", meeting_type: "meet" }, error: null },
    ],
    "meeting_participants:select": [
      { data: [{ user_id: "keep1" }, { user_id: "keep2" }, { user_id: "rem1" }], error: null },
    ],
  });
  const res = await actions.updateMeeting({
    ...INPUT,
    participantIds: ["keep1", "keep2", "add1", "add1"], // dup proposital
  });
  assert.equal(res.ok, true);

  const del = ops.find((o) => o.table === "meeting_participants" && o.verb === "delete");
  assert.ok(del, "deveria remover quem saiu");
  assert.deepEqual(del.filters["in:user_id"], ["rem1"]);

  const ins = ops.find((o) => o.table === "meeting_participants" && o.verb === "insert");
  assert.ok(ins, "deveria inserir quem entrou");
  assert.deepEqual(ins.payload, [{ meeting_id: "m1", user_id: "add1" }]);

  // Quem fica NÃO aparece em nenhuma escrita (não perde response, não re-notifica).
  assert.ok(!JSON.stringify(ins.payload).includes("keep1"));
  assert.ok(!(del.filters["in:user_id"] ?? []).includes("keep1"));
});

test("edição sem mudança de convidados: nenhuma escrita em meeting_participants", async () => {
  const { ops } = clientFor({
    "meetings:select": [
      { data: { created_by: "u1", google_event_id: "evt1", meeting_type: "meet" }, error: null },
    ],
    "meeting_participants:select": [
      { data: [{ user_id: "keep1" }], error: null },
    ],
  });
  const res = await actions.updateMeeting({ ...INPUT, participantIds: ["keep1"] });
  assert.equal(res.ok, true);
  const writes = ops.filter(
    (o) => o.table === "meeting_participants" && (o.verb === "insert" || o.verb === "delete")
  );
  assert.equal(writes.length, 0);
});

test("falha ao LER convidados atuais: avisa e NÃO apaga nada (B16)", async () => {
  const { ops } = clientFor({
    "meetings:select": [
      { data: { created_by: "u1", google_event_id: "evt1", meeting_type: "meet" }, error: null },
    ],
    "meeting_participants:select": [
      { data: null, error: { code: "XX000", message: "boom" } },
    ],
  });
  const res = await actions.updateMeeting({ ...INPUT, participantIds: ["novo"] });
  assert.equal(res.ok, true);
  assert.match(res.warning ?? "", /convidados/i);
  const writes = ops.filter(
    (o) => o.table === "meeting_participants" && (o.verb === "insert" || o.verb === "delete")
  );
  assert.equal(writes.length, 0, "com a leitura falha, não pode apagar/inserir às cegas");
});

test("não criador é recusado antes de qualquer escrita", async () => {
  const { ops } = clientFor({
    "meetings:select": [
      { data: { created_by: "outra-pessoa", google_event_id: null, meeting_type: "meet" }, error: null },
    ],
  });
  const res = await actions.updateMeeting({ ...INPUT, participantIds: [] });
  assert.equal(res.ok, false);
  assert.match(res.error, /quem criou/);
  assert.equal(ops.filter((o) => o.verb !== "select").length, 0);
});

test("validação: fim antes do início e título vazio barram no servidor", async () => {
  clientFor({});
  const r1 = await actions.updateMeeting({
    ...INPUT,
    startISO: "2026-12-01T14:00:00.000Z",
    endISO: "2026-12-01T13:00:00.000Z",
  });
  assert.deepEqual(r1, { ok: false, error: "O fim deve ser depois do início." });
  const r2 = await actions.updateMeeting({ ...INPUT, title: "   " });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /título/);
});

test("criação sem Google conectado: reunião salva, convidados gravados, aviso claro", async () => {
  const { ops } = clientFor({
    "meetings:insert": [{ data: { id: "m-novo" }, error: null }],
  });
  const res = await actions.createMeeting({ ...INPUT, participantIds: ["p1", "p2"] });
  assert.equal(res.ok, true);
  assert.equal(res.meetingId, "m-novo");
  assert.equal(res.sync, "nao_conectado");
  assert.match(res.warning ?? "", /não está conectada/);
  const ins = ops.find((o) => o.table === "meeting_participants" && o.verb === "insert");
  assert.deepEqual(ins.payload, [
    { meeting_id: "m-novo", user_id: "p1" },
    { meeting_id: "m-novo", user_id: "p2" },
  ]);
  // setSync gravou nao_conectado via RPC meetings_set_sync (0175).
  const sync = ops.find((o) => o.table === "rpc:meetings_set_sync");
  assert.ok(sync, "setSync deveria chamar a RPC meetings_set_sync");
  assert.equal(sync.payload.p_status, "nao_conectado");
  assert.equal(sync.payload.p_has_event, false);
});
