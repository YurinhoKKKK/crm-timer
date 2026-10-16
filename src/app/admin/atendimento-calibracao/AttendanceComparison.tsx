"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { brDate, monthYearLabel } from "@/lib/period";
import type { Grouping } from "./AttendanceReport";

// Comparação ESTIMADO (Digisac, etapa 2) x CRONOMETRADO (calibração, 0126) para os
// dois Marcos. "Estimado" tem duas versões: total e FORA de cronômetro de tarefa
// (minutes - overlap_task); o padrão é "fora de tarefa", que é o que se compara com
// o cronômetro de atendimento. Mostra também, como informação, o chat dentro do
// Controle de Conta e o tempo cronometrado do Controle de Conta. A RPC já devolve
// por (pessoa, empresa, balde); aqui só agregamos e formatamos.

export type ComparisonRow = {
  profile_id: string;
  user_name: string;
  company_id: string;
  company_number: string | null;
  company_name: string;
  bucket: string; // YYYY-MM-DD
  timed_minutes: number;
  est_minutes: number;
  est_out_task_minutes: number;
  cc_chat_minutes: number;
  cc_timed_minutes: number;
};

type Base = "out" | "total";
const GROUP_LABEL: Record<Grouping, string> = { day: "Dia", week: "Semana", month: "Mês" };

function fmtMin(min: number): string {
  const m = Math.round(min);
  if (m <= 0) return "—";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}min`;
  return `${h}h${r > 0 ? ` ${r}min` : ""}`;
}
function fmtRatio(est: number, timed: number): string {
  if (timed <= 0) return "—";
  return `${(est / timed).toFixed(2)}×`;
}
function bucketLabel(bucket: string, group: Grouping): string {
  if (group === "month") return monthYearLabel(bucket.slice(0, 7));
  if (group === "week") return `sem. ${brDate(bucket).slice(0, 5)}`;
  return brDate(bucket).slice(0, 5);
}
function companyLabel(r: { company_number: string | null; company_name: string }): string {
  return r.company_number ? `${r.company_number} — ${r.company_name}` : r.company_name;
}

type CompanyAgg = {
  companyId: string;
  label: string;
  timed: number;
  estTotal: number;
  estOut: number;
  ccChat: number;
  ccTimed: number;
};
type Person = {
  profileId: string;
  name: string;
  companies: CompanyAgg[];
  timed: number;
  estTotal: number;
  estOut: number;
  ccChat: number;
  ccTimed: number;
};

const num = (v: number) => Number(v) || 0;

export default function AttendanceComparison({
  rows,
  group,
  includeAuto,
}: {
  rows: ComparisonRow[];
  group: Grouping;
  includeAuto: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [base, setBase] = useState<Base>("out");

  function setParam(key: string, value: string | null) {
    const sp = new URLSearchParams(searchParams?.toString());
    if (value === null) sp.delete(key);
    else sp.set(key, value);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const estOf = (c: { estOut: number; estTotal: number }) => (base === "out" ? c.estOut : c.estTotal);

  const people = useMemo<Person[]>(() => {
    const pm = new Map<string, Person>();
    for (const r of rows) {
      let p = pm.get(r.profile_id);
      if (!p) {
        p = { profileId: r.profile_id, name: r.user_name, companies: [], timed: 0, estTotal: 0, estOut: 0, ccChat: 0, ccTimed: 0 };
        pm.set(r.profile_id, p);
      }
      let c = p.companies.find((x) => x.companyId === r.company_id);
      if (!c) {
        c = { companyId: r.company_id, label: companyLabel(r), timed: 0, estTotal: 0, estOut: 0, ccChat: 0, ccTimed: 0 };
        p.companies.push(c);
      }
      c.timed += num(r.timed_minutes);
      c.estTotal += num(r.est_minutes);
      c.estOut += num(r.est_out_task_minutes);
      c.ccChat += num(r.cc_chat_minutes);
      c.ccTimed += num(r.cc_timed_minutes);
      p.timed += num(r.timed_minutes);
      p.estTotal += num(r.est_minutes);
      p.estOut += num(r.est_out_task_minutes);
      p.ccChat += num(r.cc_chat_minutes);
      p.ccTimed += num(r.cc_timed_minutes);
    }
    const list = Array.from(pm.values());
    for (const p of list) p.companies.sort((a, b) => Math.max(b.estOut, b.timed) - Math.max(a.estOut, a.timed));
    list.sort((a, b) => b.estOut - a.estOut);
    return list;
  }, [rows]);

  function exportCsv() {
    const header = [
      "Pessoa", "Empresa", "Balde", "Cronometrado (min)", "Estimado total (min)",
      "Estimado fora de tarefa (min)", "Chat em Controle de Conta (min)",
      "Cronometro Controle de Conta (min)", "Razao (estimado fora / cronometrado)",
    ];
    const br = (n: number) => n.toFixed(1).replace(".", ",");
    const lines = [header.join(";")];
    for (const r of rows) {
      const timed = num(r.timed_minutes);
      const estOut = num(r.est_out_task_minutes);
      lines.push([
        r.user_name, companyLabel(r).replace(/;/g, ","), r.bucket,
        br(timed), br(num(r.est_minutes)), br(estOut), br(num(r.cc_chat_minutes)),
        br(num(r.cc_timed_minutes)), timed > 0 ? (estOut / timed).toFixed(2).replace(".", ",") : "",
      ].join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comparacao-atendimento.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mb-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">Estimado × Cronometrado</h2>
          <p className="text-sm text-fg-muted">
            A comparação usa o estimado <strong>fora de cronômetro de tarefa</strong>. O chat
            dentro de tarefa já está no cronômetro e não é contado em dobro.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Base do estimado" className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card">
            {(["out", "total"] as Base[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBase(b)}
                aria-pressed={base === b}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  base === b ? "bg-risd text-white shadow-sm" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {b === "out" ? "Fora de tarefa" : "Total"}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Agrupar por" className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card">
            {(["day", "week", "month"] as Grouping[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setParam("group", g)}
                aria-pressed={g === group}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  g === group ? "bg-risd text-white shadow-sm" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg-muted shadow-card">
            <input
              type="checkbox"
              checked={!includeAuto}
              onChange={(e) => setParam("auto", e.target.checked ? null : "1")}
              className="h-4 w-4 rounded border-line text-risd focus:ring-risd"
            />
            Excluir auto-encerrados
          </label>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        O cronômetro de calibração começou em <strong>14/10/2026</strong>. Antes disso há apenas a
        estimativa — a razão só é significativa onde existe tempo cronometrado.
      </p>

      {people.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-subtle shadow-card">
          Sem dados de atendimento no período.
        </div>
      ) : (
        people.map((p) => {
          const estPersonTotal = base === "out" ? p.estOut : p.estTotal;
          return (
            <section key={p.profileId} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-fg">{p.name}</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-fg-muted">
                    Cronometrado <span className="font-semibold text-fg">{fmtMin(p.timed)}</span>
                  </span>
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-fg-muted">
                    Estimado {base === "out" ? "fora de tarefa" : "total"}{" "}
                    <span className="font-semibold text-fg">{fmtMin(estPersonTotal)}</span>
                  </span>
                  <span className="rounded-full bg-risd/10 px-2.5 py-1 text-risd">
                    Razão <span className="font-semibold">{fmtRatio(estPersonTotal, p.timed)}</span>
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                      <th className="py-1.5 pr-3 font-medium">Empresa</th>
                      <th className="px-2 py-1.5 text-right font-medium">Cronometrado</th>
                      <th className="px-2 py-1.5 text-right font-medium">Est. {base === "out" ? "fora tarefa" : "total"}</th>
                      <th className="px-2 py-1.5 text-right font-medium">Razão</th>
                      <th className="px-2 py-1.5 text-right font-medium text-fg-subtle">Chat em CC</th>
                      <th className="px-2 py-1.5 text-right font-medium text-fg-subtle">Cronô. CC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.companies.map((c) => {
                      const est = estOf(c);
                      const onlyEst = c.timed <= 0 && est > 0;
                      const onlyTimed = est <= 0 && c.timed > 0;
                      return (
                        <tr key={c.companyId} className="border-b border-line/60">
                          <td className="py-1.5 pr-3 text-fg">
                            {c.label}
                            {onlyEst && (
                              <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">só estimado</span>
                            )}
                            {onlyTimed && (
                              <span className="ml-2 rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300">só cronômetro</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtMin(c.timed)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtMin(est)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium text-fg">{fmtRatio(est, c.timed)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">{fmtMin(c.ccChat)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">{fmtMin(c.ccTimed)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-line font-semibold">
                      <td className="py-1.5 pr-3 text-fg">Total</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg">{fmtMin(p.timed)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg">{fmtMin(estPersonTotal)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-risd">{fmtRatio(estPersonTotal, p.timed)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">{fmtMin(p.ccChat)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg-subtle">{fmtMin(p.ccTimed)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
