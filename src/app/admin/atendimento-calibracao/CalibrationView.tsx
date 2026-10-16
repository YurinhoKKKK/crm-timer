"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Wrench, SlidersHorizontal, X, ChevronDown } from "lucide-react";
import { addDays, brtToday, brtYesterday, brDate } from "@/lib/period";
import { loadCompanyTimeline } from "./actions";
import { CALIB_START } from "./constants";

// Tela de calibração do contador de atendimento. Objetivo único: a estimativa está
// acertando? Três blocos — cartão por pessoa, gráfico por dia, e por empresa — sobre
// os MESMOS dados (attendance_comparison). Só apresentação.

export type ComparisonRow = {
  profile_id: string; user_name: string;
  company_id: string; company_number: string | null; company_name: string;
  bucket: string;
  timed_minutes: number; est_minutes: number; est_out_task_minutes: number;
  cc_chat_minutes: number; cc_timed_minutes: number; sessions: number;
};
export type PersonOpt = { id: string; name: string };
type Base = "out" | "total";
type ChartGroup = "day" | "week";

const num = (v: number | null | undefined) => Number(v) || 0;

// "1h14" / "45 min" / "—" (nunca decimal).
function fmtMin(min: number): string {
  const m = Math.round(num(min));
  if (m <= 0) return "—";
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
}
// Diferença em minutos, com sinal: "+30 min" / "-6 min".
function fmtDiff(min: number): string {
  const m = Math.round(num(min));
  return `${m > 0 ? "+" : m < 0 ? "−" : ""}${Math.abs(m)} min`;
}
function fmtTimes(x: number): string {
  return `${x.toFixed(1).replace(".", ",")} vezes`;
}
const companyName = (r: { company_name: string }) => r.company_name; // já começa com o número

// -------- segunda-feira da semana de uma data pura (âncora UTC) --------
function mondayOf(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=dom..6=sáb
  return addDays(ymd, -((dow + 6) % 7));
}

// =====================================================================
type Co = {
  id: string; name: string;
  timed: number; estOut: number; estTotal: number; sessions: number;
  ccChat: number; ccTimed: number;
};
type Agg = {
  id: string; name: string;
  companies: Co[];
  totalTimed: number; totalEstOut: number; totalEstTotal: number;
};

export default function CalibrationView({
  rows, period, includeAuto, people,
}: {
  rows: ComparisonRow[]; period: { start: string; end: string; label: string };
  includeAuto: boolean; people: PersonOpt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [base, setBase] = useState<Base>("out");

  function setRange(start: string, end: string) {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set("de", start); sp.set("ate", end);
    router.push(`${pathname}?${sp.toString()}`);
  }
  function setAuto(exclude: boolean) {
    const sp = new URLSearchParams(searchParams?.toString());
    if (exclude) sp.delete("auto"); else sp.set("auto", "1");
    router.push(`${pathname}?${sp.toString()}`);
  }

  const estOf = (c: Co) => (base === "out" ? c.estOut : c.estTotal);

  // Agrega por pessoa → empresa (sobre os baldes do período).
  const byPerson = useMemo<Agg[]>(() => {
    const pm = new Map<string, Agg>();
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    for (const r of rows) {
      let p = pm.get(r.profile_id);
      if (!p) {
        p = { id: r.profile_id, name: r.user_name, companies: [], totalTimed: 0, totalEstOut: 0, totalEstTotal: 0 };
        pm.set(r.profile_id, p);
      }
      let c = p.companies.find((x) => x.id === r.company_id);
      if (!c) {
        c = { id: r.company_id, name: companyName(r), timed: 0, estOut: 0, estTotal: 0, sessions: 0, ccChat: 0, ccTimed: 0 };
        p.companies.push(c);
      }
      c.timed += num(r.timed_minutes); c.estOut += num(r.est_out_task_minutes); c.estTotal += num(r.est_minutes);
      c.sessions += num(r.sessions); c.ccChat += num(r.cc_chat_minutes); c.ccTimed += num(r.cc_timed_minutes);
      p.totalTimed += num(r.timed_minutes); p.totalEstOut += num(r.est_out_task_minutes); p.totalEstTotal += num(r.est_minutes);
    }
    // garante um cartão por pessoa calibrando mesmo sem atividade
    for (const po of people) if (!pm.has(po.id)) pm.set(po.id, { id: po.id, name: nameOf.get(po.id) ?? po.name, companies: [], totalTimed: 0, totalEstOut: 0, totalEstTotal: 0 });
    return Array.from(pm.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, people]);

  function exportCsv() {
    const br = (n: number) => num(n).toFixed(1).replace(".", ",");
    const header = ["Pessoa", "Empresa", "Cronometrado (min)", "Estimado total (min)", "Estimado fora de tarefa (min)", "Conversa em Controle de Conta (min)", "Cronometro Controle de Conta (min)", "Atendimentos"];
    const lines = [header.join(";")];
    for (const r of rows) {
      lines.push([r.user_name, companyName(r).replace(/;/g, ","), br(r.timed_minutes), br(r.est_minutes), br(r.est_out_task_minutes), br(r.cc_chat_minutes), br(r.cc_timed_minutes), String(r.sessions)].join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "calibracao-atendimento.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const today = brtToday();
  const shortcuts = [
    { key: "hoje", label: "Hoje", start: today, end: today },
    { key: "ontem", label: "Ontem", start: brtYesterday(), end: brtYesterday() },
    { key: "semana", label: "Esta semana", start: mondayOf(today), end: today },
    { key: "inicio", label: "Desde o início", start: CALIB_START, end: today },
  ];

  return (
    <div className="space-y-8">
      {/* Período + menus */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-subtle">Período: <span className="font-medium text-fg-muted">{period.label}</span></span>
          <div className="inline-flex flex-wrap gap-1">
            {shortcuts.map((s) => {
              const active = period.start === s.start && period.end === s.end;
              return (
                <button key={s.key} type="button" onClick={() => setRange(s.start, s.end)} aria-pressed={active}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${active ? "border-risd bg-risd text-white" : "border-line bg-surface text-fg-muted hover:border-risd/50 hover:text-fg"}`}>
                  {s.label}
                </button>
              );
            })}
            <input type="date" value={period.start} max={period.end} onChange={(e) => e.target.value && setRange(e.target.value, period.end)} aria-label="Início"
              className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-fg shadow-sm focus:border-risd focus:outline-none" />
            <input type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && setRange(period.start, e.target.value)} aria-label="Fim"
              className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-fg shadow-sm focus:border-risd focus:outline-none" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Menu label="Opções" icon={<SlidersHorizontal className="h-4 w-4" />}>
            <label className="flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-surface-2">
              <input type="checkbox" checked={!includeAuto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 rounded border-line text-risd focus:ring-risd" />
              Excluir auto-encerrados
            </label>
            <div className="border-t border-line px-3 py-2">
              <div className="mb-1 text-xs text-fg-subtle">Estimativa</div>
              <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
                <button type="button" onClick={() => setBase("out")} aria-pressed={base === "out"} className={`rounded px-2 py-1 font-medium ${base === "out" ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>Fora de tarefa</button>
                <button type="button" onClick={() => setBase("total")} aria-pressed={base === "total"} className={`rounded px-2 py-1 font-medium ${base === "total" ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>Total</button>
              </div>
            </div>
          </Menu>
          <Menu label="Ferramentas" icon={<Wrench className="h-4 w-4" />}>
            <Link href="/admin/atendimento-calibracao/parametros" className="block px-3 py-2 text-sm text-fg hover:bg-surface-2">Parâmetros</Link>
            <Link href="/admin/atendimento-calibracao/pessoas" className="block px-3 py-2 text-sm text-fg hover:bg-surface-2">Pessoas (Digisac)</Link>
            <Link href="/admin/atendimento-calibracao/sessoes" className="block px-3 py-2 text-sm text-fg hover:bg-surface-2">Sessões</Link>
            <button type="button" onClick={exportCsv} className="block w-full border-t border-line px-3 py-2 text-left text-sm text-fg hover:bg-surface-2">Exportar CSV</button>
          </Menu>
        </div>
      </div>

      {/* BLOCO 1: cartão por pessoa */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {byPerson.map((p) => <PersonCard key={p.id} p={p} base={base} estOf={estOf} />)}
      </div>

      {/* BLOCO 2: gráfico por dia */}
      <DailyChart byPerson={byPerson} rows={rows} />

      {/* BLOCO 3: por empresa */}
      <div className="space-y-4">
        {byPerson.map((p) => <PersonCompanies key={p.id} p={p} base={base} estOf={estOf} period={period} />)}
      </div>
    </div>
  );
}

// -------------------------------------------------------- menu (dropdown)
function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg-muted shadow-sm transition hover:border-risd/50 hover:text-fg">
        {icon} {label} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-overlay mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop">
          {children}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------- bloco 1
function PersonCard({ p, base, estOf }: { p: Agg; base: Base; estOf: (c: Co) => number }) {
  const timed = p.totalTimed;
  const est = base === "out" ? p.totalEstOut : p.totalEstTotal;
  const comparable = p.companies.filter((c) => c.timed > 0 && estOf(c) > 0);
  const cTimed = comparable.reduce((s, c) => s + c.timed, 0);
  const cEst = comparable.reduce((s, c) => s + estOf(c), 0);
  const conversa = p.companies.filter((c) => estOf(c) > 0).length;
  const coverage = conversa > 0 ? comparable.length / conversa : 0;
  const lowCoverage = conversa > 0 && coverage < 0.7;
  const scale = Math.max(1, timed, est);

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h3 className="mb-2 font-semibold text-fg">{p.name}</h3>
      {timed <= 0 ? (
        <p className="text-sm text-fg">Ainda não cronometrou neste período. A estimativa deu <strong>{fmtMin(est)}</strong>.</p>
      ) : (
        <p className="text-sm text-fg">
          Cronometrou <strong>{fmtMin(timed)}</strong>. A estimativa deu <strong>{fmtMin(est)}</strong>:{" "}
          {est >= timed ? `${fmtMin(est - timed)} a mais` : `${fmtMin(timed - est)} a menos`}.
        </p>
      )}

      {/* barras */}
      <div className="mt-3 space-y-1.5">
        <Bar2 label="Cronometrado" value={timed} scale={scale} tone="bg-sky-500" />
        <Bar2 label="Estimado" value={est} scale={scale} tone="bg-risd" />
      </div>

      <p className="mt-3 text-sm text-fg-muted">
        {comparable.length > 0
          ? <>Nas empresas comparáveis: cronômetro <strong className="text-fg">{fmtMin(cTimed)}</strong>, estimativa <strong className="text-fg">{fmtMin(cEst)}</strong>.</>
          : "Nenhuma empresa comparável no período (com cronômetro e estimativa)."}
      </p>
      {comparable.length > 0 && cTimed > 0 && (
        <p className="text-xs text-fg-subtle">A estimativa é {fmtTimes(cEst / cTimed)} o cronometrado, nas comparáveis.</p>
      )}
      <p className="mt-1 text-sm text-fg-muted">
        Cronometrou em <strong className="text-fg">{comparable.length}</strong> das <strong className="text-fg">{conversa}</strong> empresas com conversa no período.
      </p>
      {lowCoverage && (
        <p className="mt-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Cobertura baixa: a comparação ainda não é confiável.
        </p>
      )}
    </section>
  );
}

function Bar2({ label, value, scale, tone }: { label: string; value: number; scale: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-fg-muted">{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
        <div className={`h-full rounded ${tone}`} style={{ width: `${Math.min(100, (num(value) / scale) * 100)}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg">{fmtMin(value)}</span>
    </div>
  );
}

// -------------------------------------------------------- bloco 2 (gráfico)
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// Rótulo curto que DISTINGUE homônimos (dois "Marco"): primeiro nome; se outra
// pessoa começa igual, primeiro + último ("Marco Gomes" / "Marco Jesus"); se ainda
// empatar, o nome completo. `all` é a lista de nomes entre os quais desambiguar.
function shortPersonLabel(name: string, all: string[]): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? name;
  const firstKey = first.toLowerCase();
  const firstCollides = all.filter((n) => (n.trim().split(/\s+/)[0] ?? "").toLowerCase() === firstKey).length > 1;
  if (!firstCollides) return first;
  const candidate = words.length > 1 ? `${first} ${words[words.length - 1]}` : first;
  const candKey = candidate.toLowerCase();
  const candCollides = all.filter((n) => {
    const w = n.trim().split(/\s+/);
    const c = w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : w[0] ?? n;
    return c.toLowerCase() === candKey;
  }).length > 1;
  return candCollides ? name : candidate;
}

function DailyChart({ byPerson, rows }: { byPerson: Agg[]; rows: ComparisonRow[] }) {
  const dark = useIsDark();
  const [group, setGroup] = useState<ChartGroup>("day");
  const [personId, setPersonId] = useState<string>(byPerson[0]?.id ?? "");
  const activeId = byPerson.some((p) => p.id === personId) ? personId : byPerson[0]?.id ?? "";

  const data = useMemo(() => {
    const m = new Map<string, { label: string; key: string; cron: number; est: number }>();
    for (const r of rows) {
      if (r.profile_id !== activeId) continue;
      const key = group === "week" ? mondayOf(r.bucket) : r.bucket;
      let row = m.get(key);
      if (!row) { row = { key, label: group === "week" ? `sem. ${brDate(key).slice(0, 5)}` : brDate(key).slice(0, 5), cron: 0, est: 0 }; m.set(key, row); }
      row.cron += num(r.timed_minutes); row.est += num(r.est_out_task_minutes);
    }
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [rows, activeId, group]);

  const grid = dark ? "#2A313A" : "#E4E2DF";
  const axis = dark ? "#9AA2AC" : "#5B636C";
  const personNames = byPerson.map((p) => p.name);

  function tooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string }) {
    if (!active || !payload?.length) return null;
    const cron = payload.find((p) => p.dataKey === "cron")?.value ?? 0;
    const est = payload.find((p) => p.dataKey === "est")?.value ?? 0;
    return (
      <div className="rounded-xl border border-line bg-surface p-3 text-xs shadow-pop">
        <p className="mb-1 font-semibold text-fg">{label}</p>
        <p className="text-fg-muted">Cronometrado: <span className="tabular-nums text-fg">{fmtMin(cron)}</span></p>
        <p className="text-fg-muted">Estimado fora de tarefa: <span className="tabular-nums text-fg">{fmtMin(est)}</span></p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-fg">Por dia</h3>
        <div className="flex flex-wrap items-center gap-2">
          {byPerson.length > 1 && (
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs">
              {byPerson.map((p) => (
                <button key={p.id} type="button" onClick={() => setPersonId(p.id)} aria-pressed={p.id === activeId}
                  className={`rounded px-2 py-1 font-medium ${p.id === activeId ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>
                  {shortPersonLabel(p.name, personNames)}
                </button>
              ))}
            </div>
          )}
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs">
            <button type="button" onClick={() => setGroup("day")} aria-pressed={group === "day"} className={`rounded px-2 py-1 font-medium ${group === "day" ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>Dia</button>
            <button type="button" onClick={() => setGroup("week")} aria-pressed={group === "week"} className={`rounded px-2 py-1 font-medium ${group === "week" ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>Semana</button>
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-fg-muted"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Cronometrado</span>
        <span className="inline-flex items-center gap-1.5 text-fg-muted"><span className="h-2.5 w-2.5 rounded-sm bg-risd" /> Estimado fora de tarefa</span>
      </div>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-subtle">Nenhum atendimento no período.</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: grid }} />
              <YAxis tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} width={40}
                label={{ value: "minutos", angle: -90, position: "insideLeft", fill: axis, fontSize: 11 }} />
              <Tooltip cursor={{ fill: dark ? "rgba(120,140,255,0.14)" : "rgba(49,69,255,0.08)" }}
                content={tooltip as unknown as ComponentProps<typeof Tooltip>["content"]} />
              <Bar dataKey="cron" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              <Bar dataKey="est" fill="#4f46e5" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// -------------------------------------------------------- bloco 3 (por empresa)
function PersonCompanies({ p, base, estOf, period }: { p: Agg; base: Base; estOf: (c: Co) => number; period: { start: string; end: string } }) {
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState<Co | null>(null);

  const comparable = p.companies.filter((c) => c.timed > 0 && estOf(c) > 0).sort((a, b) => Math.abs(estOf(b) - b.timed) - Math.abs(estOf(a) - a.timed));
  const semCron = p.companies.filter((c) => estOf(c) > 0 && c.timed <= 0).sort((a, b) => estOf(b) - estOf(a));
  const semEst = p.companies.filter((c) => c.timed > 0 && estOf(c) <= 0).sort((a, b) => b.timed - a.timed);
  const semCronTotal = semCron.reduce((s, c) => s + estOf(c), 0);

  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left">
        <h3 className="font-semibold text-fg">{p.name} — por empresa</h3>
        <ChevronDown className={`h-4 w-4 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 px-5 pb-5">
          {/* Comparáveis */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Comparáveis</h4>
            {comparable.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nenhuma empresa com cronômetro e estimativa.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                      <th className="py-1.5 pr-3 font-medium">Empresa</th>
                      <th className="px-2 py-1.5 text-right font-medium">Cronometrado</th>
                      <th className="px-2 py-1.5 text-right font-medium">Estimado</th>
                      <th className="px-2 py-1.5 text-right font-medium">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparable.map((c) => (
                      <tr key={c.id} className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => setSel(c)}>
                        <td className="py-1.5 pr-3 text-fg">{c.name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtMin(c.timed)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtMin(estOf(c))}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-fg">{fmtDiff(estOf(c) - c.timed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Conversa sem cronômetro */}
          {semCron.length > 0 && (
            <Collapsible title={`Conversa sem cronômetro (${semCron.length} · ${fmtMin(semCronTotal)})`} subtitle="Esqueceu de cronometrar ou foi uma conversa rápida?">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th className="py-1.5 pr-3 font-medium">Empresa</th>
                    <th className="px-2 py-1.5 text-right font-medium">Estimado</th>
                    <th className="px-2 py-1.5 text-right font-medium">Contatos</th>
                  </tr>
                </thead>
                <tbody>
                  {semCron.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => setSel(c)}>
                      <td className="py-1.5 pr-3 text-fg">{c.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtMin(estOf(c))}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{c.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapsible>
          )}

          {/* Cronômetro sem conversa estimada */}
          {semEst.length > 0 && (
            <Collapsible title={`Cronômetro sem conversa estimada (${semEst.length})`}>
              <table className="w-full min-w-[24rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th className="py-1.5 pr-3 font-medium">Empresa</th>
                    <th className="px-2 py-1.5 text-right font-medium">Cronometrado</th>
                  </tr>
                </thead>
                <tbody>
                  {semEst.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => setSel(c)}>
                      <td className="py-1.5 pr-3 text-fg">{c.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtMin(c.timed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapsible>
          )}
        </div>
      )}

      {sel && <CompanyPanel person={p} co={sel} period={period} onClose={() => setSel(null)} />}
    </section>
  );
}

function Collapsible({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <div>
          <span className="text-sm font-medium text-fg">{title}</span>
          {subtitle && <span className="ml-2 text-xs text-fg-subtle">{subtitle}</span>}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="overflow-x-auto px-3 pb-3">{children}</div>}
    </div>
  );
}

type TL = { kind: "estimada" | "cronometro"; started_at: string; ended_at: string | null; minutes: number; team_msgs: number | null; client_msgs: number | null; in_task: boolean | null; auto_closed: boolean | null };

function CompanyPanel({ person, co, period, onClose }: { person: Agg; co: Co; period: { start: string; end: string }; onClose: () => void }) {
  const [rows, setRows] = useState<TL[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadCompanyTimeline(period.start, period.end, person.id, co.id).then((r) => { if (alive) setRows(r as TL[]); });
    return () => { alive = false; };
  }, [person.id, co.id, period.start, period.end]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <div className="fixed inset-0 z-sheet flex" role="dialog" aria-modal="true" aria-label={co.name}>
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="h-full w-full overflow-y-auto border-l border-line bg-surface p-5 shadow-pop sm:w-[32rem]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="font-semibold text-fg">{co.name}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"><X className="h-5 w-5" /></button>
        </div>
        {(co.ccChat > 0 || co.ccTimed > 0) && (
          <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            Conversa durante Controle de Conta: {fmtMin(co.ccChat)} · Cronômetro do Controle de Conta: {fmtMin(co.ccTimed)}
          </p>
        )}
        {rows === null ? (
          <p className="text-sm text-fg-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nada no período.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-line/60 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  {r.kind === "estimada"
                    ? <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">estimada</span>
                    : <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">cronômetro</span>}
                  <span className="tabular-nums text-fg-muted">{hm(r.started_at)}–{hm(r.ended_at)}</span>
                  {r.in_task && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">em tarefa</span>}
                  {r.auto_closed && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-500/15 dark:text-red-300">auto</span>}
                </span>
                <span className="tabular-nums text-fg">{fmtMin(r.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
