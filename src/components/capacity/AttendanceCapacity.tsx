"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, X, Search } from "lucide-react";
import { addDays, brtYesterday, brtToday, brDate, lastDayOfMonth, shiftMonth } from "@/lib/period";
import { loadPersonClients, loadClientPeople } from "@/app/admin/capacidade/attendance-actions";

// Seção "Atendimento por WhatsApp" da Capacidade (admin-only), em três abas: Resumo,
// Pessoas, Clientes. Só apresentação — os números vêm das RPCs (etapa 3). Regra: a
// CARGA de uma pessoa é o chat FORA de cronômetro de tarefa; por cliente, o chat TOTAL.

export type AtParams = {
  gap_minutes: number; floor_minutes: number; prep_minutes: number;
  calibrated: boolean; calibrated_at: string | null;
};
export type AtPeriod = { start: string; end: string; label: string };
export type SummaryRow = { dim: string; key: string; n_clients: number; avg_monthly_h: number | null; median_monthly_h: number | null };
export type ClientRow = {
  company_id: string; company_number: string | null; company_name: string;
  project_model: string | null; group_name: string | null;
  hours: number; monthly_hours: number; pct_out_task: number;
  sessions: number; team_msgs: number; client_msgs: number; people: number;
};
export type PersonRow = {
  person_key: string; person_label: string; profile_id: string | null; has_profile: boolean;
  out_task_hours: number; in_task_hours: number; chat_total_hours: number;
  clients: number; business_days: number; task_hours: number;
};
export type ClientPersonRow = { person_label: string; hours: number };

const num = (v: number | null | undefined) => Number(v) || 0;
const MODEL_LABEL: Record<string, string> = { bpo: "BPO", consultoria: "Consultoria", ema: "EMA", "sem modelo": "Sem modelo" };

// Horas no formato "3h20" / "45 min" / "—" (nunca decimal).
function fmtH(hours: number | null | undefined): string {
  const m = Math.round(num(hours) * 60);
  if (m <= 0) return "—";
  const hh = Math.floor(m / 60), mm = m % 60;
  if (hh === 0) return `${mm} min`;
  return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, "0")}`;
}
function companyLabel(r: { company_number: string | null; company_name: string }) {
  return r.company_number ? `${r.company_number} — ${r.company_name}` : r.company_name;
}
function modelLabel(m: string | null) {
  return MODEL_LABEL[m ?? "sem modelo"] ?? m ?? "Sem modelo";
}

type Tab = "resumo" | "pessoas" | "clientes";

export default function AttendanceCapacity({
  period, params, summary, clients, people,
}: {
  period: AtPeriod; params: AtParams | null;
  summary: SummaryRow[]; clients: ClientRow[]; people: PersonRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("resumo");

  function setPeriod(start: string, end: string) {
    const sp = new URLSearchParams(searchParams?.toString());
    sp.set("wde", start);
    sp.set("wate", end);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const geral = summary.find((s) => s.dim === "geral");
  const byModel = summary.filter((s) => s.dim === "modelo");
  const unmeasured = summary.find((s) => s.dim === "nao_medidas");
  const median = num(geral?.median_monthly_h);

  const teamOutTask = useMemo(() => people.reduce((s, p) => s + num(p.out_task_hours), 0), [people]);
  const topClients = useMemo(() => [...clients].sort((a, b) => num(b.monthly_hours) - num(a.monthly_hours)).slice(0, 5), [clients]);
  const topPeople = useMemo(() => [...people].sort((a, b) => num(b.out_task_hours) - num(a.out_task_hours)).slice(0, 5), [people]);

  const y = brtYesterday();
  const ym = brtToday().slice(0, 7);
  const presets = [
    { label: "30 dias", start: addDays(y, -29), end: y },
    { label: "7 dias", start: addDays(y, -6), end: y },
    { label: "Este mês", start: `${ym}-01`, end: y >= `${ym}-01` ? y : `${ym}-01` },
    { label: "Mês passado", start: `${shiftMonth(ym, -1)}-01`, end: lastDayOfMonth(shiftMonth(ym, -1)) },
  ];

  return (
    <section className="mt-10 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-fg">Atendimento por WhatsApp</h2>
        <p className="text-sm text-fg-muted">
          Estimativa do tempo de atendimento (Digisac) — quanto cada cliente consome e a carga de cada pessoa.
        </p>
      </div>

      {/* Período (vale para as três abas) + abas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-subtle">Período: <span className="font-medium text-fg-muted">{period.label}</span></span>
          <div className="inline-flex flex-wrap gap-1">
            {presets.map((pr) => {
              const active = period.start === pr.start && period.end === pr.end;
              return (
                <button key={pr.label} type="button" onClick={() => setPeriod(pr.start, pr.end)} aria-pressed={active}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${active ? "border-risd bg-risd text-white" : "border-line bg-surface text-fg-muted hover:border-risd/50 hover:text-fg"}`}>
                  {pr.label}
                </button>
              );
            })}
            <input type="date" value={period.start} max={period.end} onChange={(e) => e.target.value && setPeriod(e.target.value, period.end)}
              className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-fg shadow-sm focus:border-risd focus:outline-none" />
            <input type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && setPeriod(period.start, e.target.value)}
              className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-fg shadow-sm focus:border-risd focus:outline-none" />
          </div>
        </div>
        <div role="tablist" aria-label="Visão" className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card">
          {(["resumo", "pessoas", "clientes"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${tab === t ? "bg-risd text-white shadow-sm" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Faixa de calibração (curta) */}
      {params && !params.calibrated && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <strong>Estimativa em calibração.</strong> Não use para decisões ainda.{" "}
          <Link href="/admin/atendimento-calibracao/parametros" className="underline hover:text-amber-900 dark:hover:text-amber-200">Ver parâmetros</Link>.
        </p>
      )}

      {tab === "resumo" && (
        <ResumoTab
          geral={geral} byModel={byModel} unmeasured={unmeasured} median={median}
          teamOutTask={teamOutTask} topClients={topClients} topPeople={topPeople}
          onVerClientes={() => setTab("clientes")} onVerPessoas={() => setTab("pessoas")}
        />
      )}
      {tab === "pessoas" && <PessoasTab people={people} period={period} />}
      {tab === "clientes" && <ClientesTab clients={clients} median={median} period={period} />}
    </section>
  );
}

// ------------------------------------------------------------------ RESUMO
function BigCard({ value, title, sub }: { value: string; title: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="text-3xl font-bold tabular-nums text-fg">{value}</div>
      <div className="mt-1 text-sm font-medium text-fg">{title}</div>
      {sub && <div className="text-xs text-fg-subtle">{sub}</div>}
    </div>
  );
}

function ResumoTab({
  geral, byModel, unmeasured, median, teamOutTask, topClients, topPeople, onVerClientes, onVerPessoas,
}: {
  geral?: SummaryRow; byModel: SummaryRow[]; unmeasured?: SummaryRow; median: number;
  teamOutTask: number; topClients: ClientRow[]; topPeople: PersonRow[];
  onVerClientes: () => void; onVerPessoas: () => void;
}) {
  const maxModelAvg = Math.max(1, ...byModel.map((m) => num(m.avg_monthly_h)));
  const ORDER = ["bpo", "consultoria", "ema", "sem modelo"];
  const models = [...byModel].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BigCard value={fmtH(teamOutTask)} title="Atendimento no período" sub="horas fora de tarefa, equipe toda" />
        <BigCard value={fmtH(geral?.avg_monthly_h)} title="Média por cliente / mês" />
        <BigCard value={fmtH(geral?.median_monthly_h)} title="Mediana por cliente / mês" sub="o cliente típico" />
        <BigCard value={String(geral?.n_clients ?? 0)} title="Clientes medidos" sub={`${unmeasured?.n_clients ?? 0} sem grupo vinculado`} />
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h3 className="mb-3 text-sm font-semibold text-fg">Por perfil de cliente <span className="font-normal text-fg-subtle">· média por cliente/mês</span></h3>
        {models.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhum atendimento no período.</p>
        ) : (
          <div className="space-y-2">
            {models.map((m) => (
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-sm text-fg">{modelLabel(m.key)}</div>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-surface-2">
                  <div className="h-full rounded bg-risd" style={{ width: `${(num(m.avg_monthly_h) / maxModelAvg) * 100}%` }} />
                </div>
                <div className="w-28 shrink-0 text-right text-sm tabular-nums text-fg-muted">
                  {fmtH(m.avg_monthly_h)} <span className="text-fg-subtle">· {m.n_clients} cli.</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Clientes que mais consomem</h3>
            <button type="button" onClick={onVerClientes} className="text-xs font-medium text-risd hover:underline">Ver todos</button>
          </div>
          {topClients.length === 0 ? <p className="text-sm text-fg-subtle">—</p> : (
            <ul className="space-y-1.5 text-sm">
              {topClients.map((c) => (
                <li key={c.company_id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-fg">{companyLabel(c)}</span>
                  <span className="shrink-0 tabular-nums text-fg-muted">{fmtH(c.monthly_hours)}/mês</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Pessoas com mais atendimento</h3>
            <button type="button" onClick={onVerPessoas} className="text-xs font-medium text-risd hover:underline">Ver todos</button>
          </div>
          {topPeople.length === 0 ? <p className="text-sm text-fg-subtle">—</p> : (
            <ul className="space-y-1.5 text-sm">
              {topPeople.map((p) => (
                <li key={p.person_key} className="flex items-center justify-between gap-2">
                  <span className="truncate text-fg">{p.person_label}</span>
                  <span className="shrink-0 tabular-nums text-fg-muted">{fmtH(p.out_task_hours)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ PESSOAS
function PessoasTab({ people, period }: { people: PersonRow[]; period: AtPeriod }) {
  const [sel, setSel] = useState<PersonRow | null>(null);
  const rows = useMemo(
    () => [...people].sort((a, b) => (num(b.task_hours) + num(b.out_task_hours)) - (num(a.task_hours) + num(a.out_task_hours))),
    [people]
  );
  const maxTotal = Math.max(1, ...rows.map((p) => num(p.task_hours) + num(p.out_task_hours)));

  if (rows.length === 0) {
    return <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-subtle shadow-card">Nenhum atendimento no período.</div>;
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="mb-3 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sky-500" /> Tarefas</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-risd" /> Atendimento fora de tarefa</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
              <th className="py-1.5 pr-3 font-medium">Pessoa</th>
              <th className="px-2 py-1.5 font-medium">Carga (tarefas + atendimento)</th>
              <th className="px-2 py-1.5 text-right font-medium">Total</th>
              <th className="px-2 py-1.5 text-right font-medium">Por dia útil</th>
              <th className="px-2 py-1.5 text-right font-medium">Clientes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const total = num(p.task_hours) + num(p.out_task_hours);
              const perDay = p.business_days > 0 ? p.out_task_hours / p.business_days : 0;
              return (
                <tr key={p.person_key} className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => setSel(p)}>
                  <td className="py-2 pr-3 text-fg">
                    {p.person_label}
                    {!p.has_profile && <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-subtle">sem perfil</span>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex h-4 w-full min-w-[8rem] overflow-hidden rounded bg-surface-2">
                      <div className="h-full bg-sky-500" style={{ width: `${(num(p.task_hours) / maxTotal) * 100}%` }} title={`Tarefas ${fmtH(p.task_hours)}`} />
                      <div className="h-full bg-risd" style={{ width: `${(num(p.out_task_hours) / maxTotal) * 100}%` }} title={`Atendimento ${fmtH(p.out_task_hours)}`} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-fg">{fmtH(total)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmtH(perDay)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{p.clients}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sel && <PersonPanel person={sel} period={period} onClose={() => setSel(null)} />}
    </div>
  );
}

function PersonPanel({ person, period, onClose }: { person: PersonRow; period: AtPeriod; onClose: () => void }) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (person.profile_id) {
      loadPersonClients(period.start, period.end, person.profile_id).then((r) => { if (alive) setRows(r); });
    } else {
      setRows([]);
    }
    return () => { alive = false; };
  }, [person, period.start, period.end]);

  return (
    <Panel title={person.person_label} onClose={onClose}>
      {person.in_task_hours > 0 && (
        <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          + {fmtH(person.in_task_hours)} de conversa durante tarefas, já contadas em Tarefas.
        </p>
      )}
      {rows === null ? (
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</span>
      ) : !person.profile_id ? (
        <p className="text-sm text-fg-subtle">Sem perfil vinculado — não é possível listar os clientes.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">Nenhum cliente no período.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
              <th className="py-1.5 pr-3 font-medium">Cliente</th>
              <th className="px-2 py-1.5 text-right font-medium">No período</th>
              <th className="px-2 py-1.5 text-right font-medium">Por mês</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.company_id} className="border-b border-line/60">
                <td className="py-1.5 pr-3 text-fg">
                  <Link href={`/admin/empresas/${c.company_id}`} className="hover:text-risd hover:underline">{companyLabel(c)}</Link>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg">{fmtH(c.hours)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtH(c.monthly_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ CLIENTES
type CliSort = "hours" | "name";
function ClientesTab({ clients, median, period }: { clients: ClientRow[]; median: number; period: AtPeriod }) {
  const [q, setQ] = useState("");
  const [model, setModel] = useState("todos");
  const [sort, setSort] = useState<CliSort>("hours");
  const [sel, setSel] = useState<ClientRow | null>(null);

  const modelOptions = useMemo(() => {
    const set = new Set(clients.map((c) => c.project_model ?? "sem modelo"));
    return Array.from(set);
  }, [clients]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = clients.filter((c) =>
      (model === "todos" || (c.project_model ?? "sem modelo") === model) &&
      (ql === "" || companyLabel(c).toLowerCase().includes(ql))
    );
    r = [...r].sort((a, b) =>
      sort === "hours" ? num(b.monthly_hours) - num(a.monthly_hours) : companyLabel(a).localeCompare(companyLabel(b))
    );
    return r;
  }, [clients, q, model, sort]);

  const scaleMax = Math.max(1, median * 2, ...clients.map((c) => num(c.monthly_hours)));

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…"
            className="rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-3 text-sm text-fg shadow-sm focus:border-risd focus:outline-none" />
        </div>
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-fg shadow-sm focus:border-risd focus:outline-none">
          <option value="todos">Todos os modelos</option>
          {modelOptions.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs">
          <button type="button" onClick={() => setSort("hours")} aria-pressed={sort === "hours"}
            className={`rounded px-2 py-1 font-medium ${sort === "hours" ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>Horas/mês</button>
          <button type="button" onClick={() => setSort("name")} aria-pressed={sort === "name"}
            className={`rounded px-2 py-1 font-medium ${sort === "name" ? "bg-risd text-white" : "text-fg-muted hover:text-fg"}`}>Nome</button>
        </div>
        <span className="text-xs text-fg-subtle">Mediana: {fmtH(median)}/mês</span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-fg-subtle">Nenhum cliente no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <th className="py-1.5 pr-3 font-medium">Cliente</th>
                <th className="px-2 py-1.5 text-right font-medium">Horas/mês</th>
                <th className="px-2 py-1.5 font-medium">Relativo à mediana</th>
                <th className="px-2 py-1.5 font-medium">Modelo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const ratio = median > 0 ? num(c.monthly_hours) / median : 0;
                const high = median > 0 && ratio > 2;
                return (
                  <tr key={c.company_id} className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => setSel(c)}>
                    <td className="py-2 pr-3 text-fg">
                      <Link href={`/admin/empresas/${c.company_id}`} onClick={(e) => e.stopPropagation()} className="hover:text-risd hover:underline">
                        {companyLabel(c)}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-fg">{fmtH(c.monthly_hours)}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="relative h-4 w-full min-w-[7rem] overflow-hidden rounded bg-surface-2">
                          <div className={`h-full rounded ${high ? "bg-amber-500" : "bg-risd"}`} style={{ width: `${Math.min(100, (num(c.monthly_hours) / scaleMax) * 100)}%` }} />
                          {median > 0 && (
                            <div className="absolute top-0 h-full w-0.5 bg-fg/60" style={{ left: `${Math.min(100, (median / scaleMax) * 100)}%` }} title={`Mediana ${fmtH(median)}`} />
                          )}
                        </div>
                        {high && <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">{ratio.toFixed(1)}× a mediana</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-fg-muted">{modelLabel(c.project_model)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sel && <ClientPanel client={sel} period={period} onClose={() => setSel(null)} />}
    </div>
  );
}

function ClientPanel({ client, period, onClose }: { client: ClientRow; period: AtPeriod; onClose: () => void }) {
  const [rows, setRows] = useState<ClientPersonRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadClientPeople(period.start, period.end, client.company_id).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [client, period.start, period.end]);

  return (
    <Panel title={companyLabel(client)} onClose={onClose}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-fg-subtle">No período</dt><dd className="tabular-nums text-fg">{fmtH(client.hours)}</dd></div>
        <div><dt className="text-xs text-fg-subtle">% fora de tarefa</dt><dd className="tabular-nums text-fg">{num(client.pct_out_task).toFixed(0)}%</dd></div>
        <div><dt className="text-xs text-fg-subtle">Sessões</dt><dd className="tabular-nums text-fg">{client.sessions}</dd></div>
        <div><dt className="text-xs text-fg-subtle">Mensagens</dt><dd className="tabular-nums text-fg">{client.team_msgs} equipe · {client.client_msgs} cliente</dd></div>
      </dl>
      <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Quem atendeu</h4>
      {rows === null ? (
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</span>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">—</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="text-fg">{r.person_label}</span>
              <span className="tabular-nums text-fg-muted">{fmtH(r.hours)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ PAINEL
function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-sheet flex" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="h-full w-full overflow-y-auto border-l border-line bg-surface p-5 shadow-pop sm:w-[30rem]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-semibold text-fg">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
