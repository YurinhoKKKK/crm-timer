"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { brDate, monthYearLabel } from "@/lib/period";
import ExportAttendanceButton from "./ExportAttendanceButton";

export type Grouping = "day" | "week" | "month";

export type ReportRow = {
  user_id: string;
  user_name: string;
  company_id: string;
  company_number: string | null;
  company_name: string;
  bucket: string; // YYYY-MM-DD
  minutes: number;
  auto_closed: boolean;
  entries: number;
};

const GROUP_LABEL: Record<Grouping, string> = { day: "Dia", week: "Semana", month: "Mês" };

function fmtMin(min: number): string {
  const m = Math.round(min);
  if (m <= 0) return "—";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}min`;
  return `${h}h${r > 0 ? ` ${r}min` : ""}`;
}

function bucketLabel(bucket: string, group: Grouping): string {
  if (group === "month") return monthYearLabel(bucket.slice(0, 7));
  if (group === "week") return `sem. ${brDate(bucket).slice(0, 5)}`; // DD/MM da segunda
  return brDate(bucket).slice(0, 5); // DD/MM
}

function companyLabel(r: { company_number: string | null; company_name: string }): string {
  return r.company_number ? `${r.company_number} — ${r.company_name}` : r.company_name;
}

export default function AttendanceReport({
  rows,
  group,
}: {
  rows: ReportRow[];
  group: Grouping;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();

  function setGroup(g: Grouping) {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set("group", g);
    // Filtro na mesma página: sem rolar ao topo, sem descartar o conteúdo atual.
    startNav(() => {
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    });
  }

  // Separa medições confiáveis (encerradas pela pessoa) das auto-encerradas.
  const clean = useMemo(() => rows.filter((r) => !r.auto_closed), [rows]);
  const auto = useMemo(() => rows.filter((r) => r.auto_closed), [rows]);

  // Colunas = baldes presentes (ordenados).
  const buckets = useMemo(
    () => Array.from(new Set(clean.map((r) => r.bucket))).sort(),
    [clean]
  );

  // Agrupa clean por pessoa -> empresa -> (bucket -> min).
  type Company = {
    companyId: string;
    label: string;
    byBucket: Record<string, number>;
    total: number;
  };
  type Person = {
    userId: string;
    name: string;
    companies: Company[];
    total: number;
  };

  const people = useMemo<Person[]>(() => {
    const pm = new Map<string, Person>();
    for (const r of clean) {
      let p = pm.get(r.user_id);
      if (!p) {
        p = { userId: r.user_id, name: r.user_name, companies: [], total: 0 };
        pm.set(r.user_id, p);
      }
      let c = p.companies.find((x) => x.companyId === r.company_id);
      if (!c) {
        c = { companyId: r.company_id, label: companyLabel(r), byBucket: {}, total: 0 };
        p.companies.push(c);
      }
      const min = Number(r.minutes) || 0;
      c.byBucket[r.bucket] = (c.byBucket[r.bucket] ?? 0) + min;
      c.total += min;
      p.total += min;
    }
    const list = Array.from(pm.values());
    for (const p of list) p.companies.sort((a, b) => b.total - a.total);
    list.sort((a, b) => b.total - a.total);
    return list;
  }, [clean]);

  // Auto-encerrados por pessoa (total, para excluir da comparação).
  const autoByPerson = useMemo(() => {
    const m = new Map<string, { name: string; minutes: number; entries: number }>();
    for (const r of auto) {
      const cur = m.get(r.user_id) ?? { name: r.user_name, minutes: 0, entries: 0 };
      cur.minutes += Number(r.minutes) || 0;
      cur.entries += Number(r.entries) || 0;
      m.set(r.user_id, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.minutes - a.minutes);
  }, [auto]);

  const totalClean = people.reduce((s, p) => s + p.total, 0);
  const totalAuto = autoByPerson.reduce((s, p) => s + p.minutes, 0);

  return (
    <div className="space-y-6">
      {/* Controles: agrupamento + CSV */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Agrupar por" className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card">
          {(["day", "week", "month"] as Grouping[]).map((g) => {
            const active = g === group;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                aria-pressed={active}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                  active ? "bg-risd text-white shadow-sm" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {GROUP_LABEL[g]}
              </button>
            );
          })}
        </div>

        <ExportAttendanceButton />
      </div>

      {people.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-subtle shadow-card">
          Nenhum atendimento no período.
        </div>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            Total no período (encerrados pela pessoa):{" "}
            <span className="font-semibold text-fg">{fmtMin(totalClean)}</span>.
          </p>

          {people.map((p) => (
            <section key={p.userId} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-fg">{p.name}</h3>
                <span className="text-sm text-fg-muted">
                  Total: <span className="font-semibold text-fg">{fmtMin(p.total)}</span>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                      <th className="py-1.5 pr-3 font-medium">Empresa</th>
                      {buckets.map((b) => (
                        <th key={b} className="px-2 py-1.5 text-right font-medium tabular-nums">
                          {bucketLabel(b, group)}
                        </th>
                      ))}
                      <th className="pl-2 py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.companies.map((c) => (
                      <tr key={c.companyId} className="border-b border-line/60">
                        <td className="py-1.5 pr-3 text-fg">{c.label}</td>
                        {buckets.map((b) => (
                          <td key={b} className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                            {c.byBucket[b] ? fmtMin(c.byBucket[b]) : "—"}
                          </td>
                        ))}
                        <td className="pl-2 py-1.5 text-right font-medium tabular-nums text-fg">
                          {fmtMin(c.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}

      {/* Auto-encerrados: contados à parte, para excluir da comparação. */}
      {autoByPerson.length > 0 && (
        <section className="rounded-2xl border border-amber-300/50 bg-amber-50 p-4 shadow-card dark:border-amber-500/30 dark:bg-amber-500/10">
          <h3 className="mb-1 font-semibold text-amber-800 dark:text-amber-300">
            Encerrados automaticamente (excluir da comparação)
          </h3>
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
            Atendimentos abertos por mais de 2h foram fechados pelo sistema — total {fmtMin(totalAuto)}.
          </p>
          <ul className="space-y-1 text-sm">
            {autoByPerson.map((a) => (
              <li key={a.name} className="flex items-center justify-between gap-3">
                <span className="text-fg">{a.name}</span>
                <span className="tabular-nums text-fg-muted">
                  {fmtMin(a.minutes)} · {a.entries} atend.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
