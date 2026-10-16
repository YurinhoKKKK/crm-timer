"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, RefreshCw } from "lucide-react";
import { saveParams, recomputeAll, setCalibrated } from "../actions";
import { brDate } from "@/lib/period";

export type AttendanceParams = {
  gap_minutes: number;
  floor_minutes: number;
  prep_minutes: number;
  long_session_minutes: number;
  broadcast_min_groups: number;
  broadcast_window_seconds: number;
  updated_at: string;
  calibrated: boolean;
  calibrated_at: string | null;
};

type Field = {
  key: keyof Omit<AttendanceParams, "updated_at">;
  label: string;
  help: string;
  step: string;
  min: number;
};

const FIELDS: Field[] = [
  { key: "gap_minutes", label: "Intervalo da sequência (min)", help: "Mensagens a até este intervalo seguem na mesma conversa.", step: "1", min: 1 },
  { key: "floor_minutes", label: "Piso por mensagem (min)", help: "Tempo mínimo de uma mensagem (texto, arquivo, áudio).", step: "0.5", min: 0 },
  { key: "prep_minutes", label: "Preparo (min)", help: "Somado ao início quando a conversa veio de uma mensagem do cliente.", step: "0.5", min: 0 },
  { key: "long_session_minutes", label: "Sessão longa (min)", help: "Acima disto a sessão é marcada como longa (ainda conta).", step: "1", min: 1 },
  { key: "broadcast_min_groups", label: "Comunicado: grupos", help: "Nº mínimo de grupos diferentes na rajada para virar comunicado colado.", step: "1", min: 2 },
  { key: "broadcast_window_seconds", label: "Comunicado: janela (s)", help: "Mensagens a até estes segundos entram na mesma rajada.", step: "1", min: 1 },
];

export default function ParamsForm({ initial }: { initial: AttendanceParams }) {
  const router = useRouter();
  const [values, setValues] = useState<AttendanceParams>(initial);
  const [saving, setSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [calib, setCalib] = useState(initial.calibrated);
  const [calibBusy, setCalibBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onToggleCalib(next: boolean) {
    setCalibBusy(true);
    setMsg(null);
    const res = await setCalibrated(next);
    setCalibBusy(false);
    if (res.error) setMsg({ kind: "err", text: res.error });
    else {
      setCalib(next);
      router.refresh();
    }
  }

  function set(key: keyof AttendanceParams, raw: string) {
    setValues((v) => ({ ...v, [key]: raw === "" ? 0 : Number(raw) }));
  }

  async function onSave() {
    setSaving(true);
    setMsg(null);
    const res = await saveParams({
      gap: Number(values.gap_minutes),
      floor: Number(values.floor_minutes),
      prep: Number(values.prep_minutes),
      long: Number(values.long_session_minutes),
      bmin: Number(values.broadcast_min_groups),
      bwin: Number(values.broadcast_window_seconds),
    });
    setSaving(false);
    if (res.error) setMsg({ kind: "err", text: res.error });
    else {
      setMsg({ kind: "ok", text: "Parâmetros salvos e histórico recalculado." });
      router.refresh();
    }
  }

  async function onRecompute() {
    setRecomputing(true);
    setMsg(null);
    const res = await recomputeAll();
    setRecomputing(false);
    if (res.error) setMsg({ kind: "err", text: res.error });
    else {
      setMsg({ kind: "ok", text: "Histórico recalculado." });
      router.refresh();
    }
  }

  const busy = saving || recomputing;

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-medium text-fg">{f.label}</span>
              <input
                type="number"
                inputMode="decimal"
                step={f.step}
                min={f.min}
                value={String(values[f.key])}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg shadow-sm focus:border-risd focus:outline-none focus:ring-1 focus:ring-risd disabled:opacity-60"
              />
              <span className="mt-1 block text-xs text-fg-subtle">{f.help}</span>
            </label>
          ))}
        </div>

        {msg && (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              msg.kind === "ok"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "border border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            }`}
          >
            {msg.text}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-risd px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-risd/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Salvando e recalculando…" : "Salvar e recalcular"}
          </button>
          <button
            type="button"
            onClick={onRecompute}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {recomputing ? "Recalculando…" : "Recalcular tudo"}
          </button>
        </div>
      </section>

      <p className="text-xs text-fg-subtle">
        O recálculo completo cobre todo o histórico desde 01/09/2026 e pode levar alguns
        segundos. O cron recalcula os últimos 3 dias a cada hora automaticamente.
      </p>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 text-sm font-semibold text-fg">Calibração</h2>
        <p className="mb-3 text-xs text-fg-subtle">
          Enquanto não concluída, a Capacidade mostra uma faixa de aviso de que os números
          ainda não devem guiar decisões. Concluída, vira uma nota discreta com a data.
          {values.calibrated_at ? ` Última marcação: ${brDate(values.calibrated_at.slice(0, 10))}.` : ""}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={calib}
            disabled={calibBusy}
            onChange={(e) => onToggleCalib(e.target.checked)}
            className="h-4 w-4 rounded border-line text-risd focus:ring-risd"
          />
          {calibBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Calibração concluída
        </label>
      </section>
    </div>
  );
}
