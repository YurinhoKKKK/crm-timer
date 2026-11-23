// Testes do cálculo de datas da grade do calendário (BRT fixo -03:00).
// Rodar: node --test tests/agenda/
import test from "node:test";
import assert from "node:assert/strict";
import {
  civilOf,
  civilKey,
  civilMidnightMs,
  civilTimeToISO,
  addDays,
  addMonths,
  weekday,
  weekStart,
  minutesInDay,
  weekRangeLabel,
  monthLabel,
  timeLabel,
} from "../../src/components/meetings/calendar/datetime.ts";
import { layoutDay } from "../../src/components/meetings/calendar/layout.ts";

test("civilOf: instante UTC cai no dia civil BRT certo (virada de dia)", () => {
  // 02:59Z de 24/11 = 23:59 BRT de 23/11 — ainda é dia 23 em Brasília.
  assert.equal(civilKey(civilOf("2026-11-24T02:59:00Z")), "2026-11-23");
  // 03:00Z de 24/11 = 00:00 BRT de 24/11 — virou o dia.
  assert.equal(civilKey(civilOf("2026-11-24T03:00:00Z")), "2026-11-24");
});

test("civilOf: virada de MÊS e de ANO em BRT (dez/2026 → jan/2027)", () => {
  // 01/01/2027 02:30Z ainda é 31/12/2026 23:30 em BRT.
  assert.equal(civilKey(civilOf("2027-01-01T02:30:00Z")), "2026-12-31");
  assert.equal(civilKey(civilOf("2027-01-01T03:00:00Z")), "2027-01-01");
});

test("civilTimeToISO: criar às 09:00 BRT vira 12:00Z; ida e volta estável", () => {
  const iso = civilTimeToISO({ y: 2026, m: 11, d: 15 }, 9, 0);
  assert.equal(iso, "2026-12-15T12:00:00.000Z");
  assert.equal(civilKey(civilOf(iso)), "2026-12-15");
  assert.equal(timeLabel(iso), "09:00");
});

test("addMonths: clampa o dia ao fim do mês destino (31/jan + 1 = 28/fev)", () => {
  assert.deepEqual(addMonths({ y: 2026, m: 0, d: 31 }, 1), { y: 2026, m: 1, d: 28 });
  // bissexto
  assert.deepEqual(addMonths({ y: 2028, m: 0, d: 31 }, 1), { y: 2028, m: 1, d: 29 });
  // navegação para trás atravessando o ano
  assert.deepEqual(addMonths({ y: 2027, m: 0, d: 15 }, -1), { y: 2026, m: 11, d: 15 });
});

test("semana começa no DOMINGO e weekRangeLabel cruza mês e ano", () => {
  // 23/11/2026 é segunda; o domingo da semana é 22/11.
  assert.deepEqual(weekStart({ y: 2026, m: 10, d: 23 }), { y: 2026, m: 10, d: 22 });
  assert.equal(weekday({ y: 2026, m: 10, d: 22 }), 0);
  // Semana 27/dez/2026 (dom) a 02/jan/2027: label com os dois anos.
  assert.equal(
    weekRangeLabel({ y: 2026, m: 11, d: 27 }),
    "27 de dezembro de 2026 – 2 de janeiro de 2027"
  );
  // Semana cruzando só o mês.
  assert.equal(
    weekRangeLabel({ y: 2026, m: 10, d: 29 }),
    "29 de novembro – 5 de dezembro de 2026"
  );
  assert.equal(monthLabel({ y: 2026, m: 11, d: 1 }), "Dezembro de 2026");
});

test("minutesInDay: evento que cruza a meia-noite BRT fica <0 / >1440 nas colunas vizinhas", () => {
  const day23 = { y: 2026, m: 10, d: 23 };
  const day24 = { y: 2026, m: 10, d: 24 };
  // 23:00 BRT do dia 23 até 01:00 BRT do dia 24.
  const startISO = civilTimeToISO(day23, 23, 0);
  const endISO = civilTimeToISO(day24, 1, 0);
  // Na coluna do dia 23: começa aos 1380 min e "termina" aos 1560 (clampa a 1440).
  assert.equal(minutesInDay(startISO, day23), 23 * 60);
  assert.equal(minutesInDay(endISO, day23), 25 * 60);
  // Na coluna do dia 24: começa aos -60 (clampa a 0) e termina aos 60.
  assert.equal(minutesInDay(startISO, day24), -60);
  assert.equal(minutesInDay(endISO, day24), 60);
});

test("grade do mês: 42 células a partir do domingo cobrem meses de 5 e 6 semanas", () => {
  // nov/2026 começa num domingo (1/11) e tem 30 dias → cabe em 5 semanas.
  const nov = weekStart({ y: 2026, m: 10, d: 1 });
  assert.deepEqual(nov, { y: 2026, m: 10, d: 1 });
  // ago/2026: dia 1 é sábado → 1+31 dias atravessam 6 linhas de semana.
  const ago = weekStart({ y: 2026, m: 7, d: 1 });
  assert.deepEqual(ago, { y: 2026, m: 6, d: 26 });
  const cells = Array.from({ length: 42 }, (_, i) => addDays(ago, i));
  assert.deepEqual(cells[6], { y: 2026, m: 7, d: 1 });
  assert.deepEqual(cells[41], { y: 2026, m: 8, d: 5 }); // inclui 31/08 (seg, linha 6)
  assert.ok(cells.some((c) => c.y === 2026 && c.m === 7 && c.d === 31));
});

test("layoutDay: 3 eventos no mesmo horário dividem 3 colunas", () => {
  const placed = layoutDay([
    { item: "a", startMin: 600, endMin: 660 },
    { item: "b", startMin: 600, endMin: 660 },
    { item: "c", startMin: 600, endMin: 660 },
  ]);
  assert.equal(placed.length, 3);
  assert.deepEqual(placed.map((p) => p.cols), [3, 3, 3]);
  assert.deepEqual(new Set(placed.map((p) => p.col)), new Set([0, 1, 2]));
});

test("layoutDay: clusters independentes não dividem largura; encadeado divide", () => {
  const placed = layoutDay([
    { item: "manha", startMin: 480, endMin: 540 },
    { item: "tarde", startMin: 900, endMin: 960 }, // sem sobreposição → cluster novo
    { item: "tarde2", startMin: 930, endMin: 990 },
  ]);
  const byItem = new Map(placed.map((p) => [p.item, p]));
  assert.equal(byItem.get("manha").cols, 1);
  assert.equal(byItem.get("tarde").cols, 2);
  assert.equal(byItem.get("tarde2").cols, 2);
  assert.notEqual(byItem.get("tarde").col, byItem.get("tarde2").col);
});

test("layoutDay: evento de 15 min reusa coluna liberada dentro do cluster", () => {
  const placed = layoutDay([
    { item: "longo", startMin: 600, endMin: 720 }, // 10:00–12:00
    { item: "curto1", startMin: 600, endMin: 615 }, // 10:00–10:15 col 1
    { item: "curto2", startMin: 630, endMin: 645 }, // 10:30–10:45 reusa col 1
  ]);
  const byItem = new Map(placed.map((p) => [p.item, p]));
  assert.equal(byItem.get("curto1").col, byItem.get("curto2").col);
  assert.equal(byItem.get("longo").cols, 2);
});
