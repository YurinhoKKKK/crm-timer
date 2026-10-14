"use client";

// Estado compartilhado do cronômetro de ATENDIMENTO na MESMA aba (calibração,
// 0126), lido tanto pelas células do painel quanto pelo indicador global. Fonte
// de verdade do "aberto" é o banco (started_at); o indicador faz o poll e semeia
// aqui. A tarefa pausada pelo atendimento (para a ação "Retomar") sobrevive a
// recarregar via sessionStorage.

import { useSyncExternalStore } from "react";
import { parseStartedAt } from "@/lib/timer";
import { startAttendance, stopAttendance } from "@/app/colaborador/attendance-actions";

export type AttendanceOpen = {
  companyId: string;
  companyNumber: string | null;
  startedAtMs: number;
} | null;
export type PausedTask = { id: string; title: string } | null;

type State = { open: AttendanceOpen; pausedTask: PausedTask };

let state: State = { open: null, pausedTask: null };
const subs = new Set<() => void>();
const PAUSED_KEY = "crm-attendance-paused-task";

function notify() {
  subs.forEach((s) => s());
}
function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
function getSnapshot(): State {
  return state;
}

export function useAttendance(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function persistPaused(p: PausedTask) {
  try {
    if (p) sessionStorage.setItem(PAUSED_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PAUSED_KEY);
  } catch {
    /* sessionStorage indisponível */
  }
}

// Recupera a tarefa pausada guardada (após recarregar a página).
export function hydratePaused() {
  try {
    const raw = sessionStorage.getItem(PAUSED_KEY);
    if (raw) {
      state = { ...state, pausedTask: JSON.parse(raw) as PausedTask };
      notify();
    }
  } catch {
    /* ignore */
  }
}

// Semeia o "aberto" a partir do banco (seed do servidor / poll do indicador).
export function seedOpenFromDb(
  row: { companyId: string; companyNumber: string | null; startedAt: string } | null
) {
  const open: AttendanceOpen = row
    ? {
        companyId: row.companyId,
        companyNumber: row.companyNumber,
        startedAtMs: parseStartedAt(row.startedAt) ?? Date.now(),
      }
    : null;
  const a = state.open;
  const same =
    (!a && !open) ||
    (!!a && !!open && a.companyId === open.companyId && a.startedAtMs === open.startedAtMs);
  if (same) return;
  state = { ...state, open };
  notify();
}

export function setPausedTask(p: PausedTask) {
  state = { ...state, pausedTask: p };
  persistPaused(p);
  notify();
}

// Inicia o atendimento numa empresa (encerra o anterior; pausa a tarefa em
// andamento no servidor, guardando-a para "Retomar"). Preserva a tarefa pausada
// anterior se este start não pausou nenhuma.
export async function doStart(
  companyId: string,
  companyNumber: string | null
): Promise<{ error: string | null }> {
  const r = await startAttendance(companyId);
  if (r.error) return { error: r.error };
  const startedAtMs = r.startedAt ? parseStartedAt(r.startedAt) ?? Date.now() : Date.now();
  const nextPaused = r.pausedTask ?? state.pausedTask;
  state = { open: { companyId, companyNumber, startedAtMs }, pausedTask: nextPaused };
  persistPaused(nextPaused);
  notify();
  return { error: null };
}

export async function doStop(): Promise<{ error: string | null }> {
  const r = await stopAttendance();
  if (r.error) return { error: r.error };
  state = { ...state, open: null };
  notify();
  return { error: null };
}
