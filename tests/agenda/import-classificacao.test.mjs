// Testa a lógica REAL (não uma cópia) de classificação da importação do Google:
// toImportRow (o que entra no espelho) e toForwardOp (ops do auto-sync
// Google→CRM, travas A1/A6/A11 da 0174). As funções vivem num arquivo
// "use server" e não são exportadas; o harness transpila o fonte e as expõe.
// Rodar: node --test tests/agenda/
import test from "node:test";
import assert from "node:assert/strict";
import { loadServerModule } from "./harness.mjs";

class GoogleError extends Error {}

// google-calendar.ts real (para meetLinkOf/SyncTokenExpired), com os imports de
// infra neutralizados.
const gcal = loadServerModule("src/lib/google-calendar.ts", {
  "server-only": {},
  "@/lib/supabase-server": {},
  "@/lib/google-oauth": {
    GoogleError,
    refreshAccessToken: async () => ({ access_token: "", expires_in: 0 }),
    expiryFromNow: () => new Date(0).toISOString(),
  },
});

const gi = loadServerModule(
  "src/app/google-import-actions.ts",
  {
    "@/lib/supabase-server": {},
    "@/lib/google-calendar": gcal,
    "@/lib/google-oauth": { GoogleError },
  },
  ["toImportRow", "toForwardOp", "monthsFrom"]
);
const { toImportRow, toForwardOp } = gi.__test;

const SYSTEM = new Set(["evt-crm"]);

const base = {
  id: "evt-x",
  status: "confirmed",
  summary: "Reunião externa",
  start: { dateTime: "2026-12-01T13:00:00Z" },
  end: { dateTime: "2026-12-01T14:00:00Z" },
};

// ---------------------------------------------------------------------
// toImportRow — o que entra no espelho importado
// ---------------------------------------------------------------------
test("importa evento comum com horário e normaliza para ISO UTC", () => {
  const row = toImportRow({ ...base, start: { dateTime: "2026-12-01T10:00:00-03:00" }, end: { dateTime: "2026-12-01T11:00:00-03:00" } }, SYSTEM);
  assert.ok(row);
  assert.equal(row.event_id, "evt-x");
  assert.equal(row.starts_at, "2026-12-01T13:00:00.000Z");
  assert.equal(row.ends_at, "2026-12-01T14:00:00.000Z");
  assert.equal(row.is_private, false);
});

test("fora do espelho: cancelado, do próprio CRM, all-day, duração <= 0, sem id", () => {
  assert.equal(toImportRow({ ...base, status: "cancelled" }, SYSTEM), null);
  assert.equal(toImportRow({ ...base, id: "evt-crm" }, SYSTEM), null);
  assert.equal(
    toImportRow({ ...base, start: { date: "2026-12-01" }, end: { date: "2026-12-02" } }, SYSTEM),
    null
  ); // dia inteiro: sem dateTime
  assert.equal(
    toImportRow({ ...base, end: { dateTime: base.start.dateTime } }, SYSTEM),
    null
  ); // fim == início
  assert.equal(toImportRow({ ...base, id: undefined }, SYSTEM), null);
});

test("recusado POR MIM fica fora; recusa de OUTRO convidado não me afeta", () => {
  assert.equal(
    toImportRow(
      { ...base, attendees: [{ self: true, responseStatus: "declined" }] },
      SYSTEM
    ),
    null
  );
  const row = toImportRow(
    { ...base, attendees: [{ self: false, responseStatus: "declined" }, { self: true, responseStatus: "accepted" }] },
    SYSTEM
  );
  assert.ok(row);
});

test("particular/confidencial marca is_private; título vazio vira null", () => {
  assert.equal(toImportRow({ ...base, visibility: "private" }, SYSTEM).is_private, true);
  assert.equal(toImportRow({ ...base, visibility: "confidential" }, SYSTEM).is_private, true);
  assert.equal(toImportRow({ ...base, visibility: "public" }, SYSTEM).is_private, false);
  assert.equal(toImportRow({ ...base, summary: "   " }, SYSTEM).title, null);
  assert.equal(toImportRow({ ...base, summary: undefined }, SYSTEM).title, null);
});

// ---------------------------------------------------------------------
// toForwardOp — ops do auto-sync Google→CRM (0172/0174)
// ---------------------------------------------------------------------
test("evento que não é reunião do CRM não gera op", () => {
  assert.equal(toForwardOp(base, SYSTEM), null);
});

test("A1: cancelamento SÓ com status=cancelled explícito", () => {
  const op = toForwardOp({ ...base, id: "evt-crm", status: "cancelled" }, SYSTEM);
  assert.deepEqual(op, { eventId: "evt-crm", cancel: true });
});

test("A11: instância de recorrência cujo MESTRE é do CRM vira motivo 'recorrente'", () => {
  const op = toForwardOp(
    { ...base, id: "evt-crm_20261201T130000Z", recurringEventId: "evt-crm" },
    SYSTEM
  );
  assert.deepEqual(op, { eventId: "evt-crm", motivo: "recorrente" });
  // Instância de recorrência de evento ALHEIO ao CRM: nada.
  assert.equal(
    toForwardOp({ ...base, recurringEventId: "outro-mestre" }, SYSTEM),
    null
  );
});

test("A6: all-day => sem_horario; fim <= início => horario_invalido", () => {
  assert.deepEqual(
    toForwardOp(
      { ...base, id: "evt-crm", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } },
      SYSTEM
    ),
    { eventId: "evt-crm", motivo: "sem_horario" }
  );
  assert.deepEqual(
    toForwardOp(
      { ...base, id: "evt-crm", end: { dateTime: "2026-12-01T12:00:00Z" } },
      SYSTEM
    ),
    { eventId: "evt-crm", motivo: "horario_invalido" }
  );
});

test("op de update carrega título/horários normalizados, meet e updated", () => {
  const op = toForwardOp(
    {
      ...base,
      id: "evt-crm",
      summary: "  Novo título  ",
      updated: "2026-11-20T10:00:00.123Z",
      hangoutLink: "https://meet.google.com/abc",
    },
    SYSTEM
  );
  assert.deepEqual(op, {
    eventId: "evt-crm",
    title: "Novo título",
    startsAt: "2026-12-01T13:00:00.000Z",
    endsAt: "2026-12-01T14:00:00.000Z",
    meetLink: "https://meet.google.com/abc",
    updated: "2026-11-20T10:00:00.123Z",
  });
  // meet via conferenceData tem prioridade sobre hangoutLink
  const op2 = toForwardOp(
    {
      ...base,
      id: "evt-crm",
      hangoutLink: "https://meet.google.com/velho",
      conferenceData: {
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+55" },
          { entryPointType: "video", uri: "https://meet.google.com/novo" },
        ],
      },
    },
    SYSTEM
  );
  assert.equal(op2.meetLink, "https://meet.google.com/novo");
});

test("título vazio no Google vira null na op (o banco grava '(sem título)')", () => {
  const op = toForwardOp({ ...base, id: "evt-crm", summary: "" }, SYSTEM);
  assert.equal(op.title, null);
});

test("dedupe por eventId (Map) colapsa N instâncias no mesmo mestre", () => {
  // Reproduz o laço de fullSync/incrementalSync: Map por op.eventId.
  const events = [
    { ...base, id: "evt-crm_1", recurringEventId: "evt-crm" },
    { ...base, id: "evt-crm_2", recurringEventId: "evt-crm" },
    { ...base, id: "evt-crm_3", recurringEventId: "evt-crm" },
  ];
  const map = new Map();
  for (const ev of events) {
    const op = toForwardOp(ev, SYSTEM);
    if (op) map.set(op.eventId, op);
  }
  assert.equal(map.size, 1);
  assert.deepEqual([...map.values()][0], { eventId: "evt-crm", motivo: "recorrente" });
});
