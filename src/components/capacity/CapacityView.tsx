"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { FilterBar, SearchBox, norm } from "@/components/ListControls";
import {
  CAPACITY_PERIODS,
  PERIOD_LABEL,
  toHours,
  type CapacityPeriod,
  type CapacityRow,
} from "@/lib/capacity";
import CapacityDrilldownPanel, {
  type DrilldownTarget,
  type DrilldownFetcher,
} from "@/components/capacity/CapacityDrilldownPanel";
import type { DrilldownScope } from "@/app/admin/capacity-actions";

// DUAS populações, DUAS tabelas empilhadas — juntar consultores (carteira, zero
// hora) e colaboradores (hora, zero carteira) numa tabela só deixava metade das
// células em traço e a outra em zero. Cada tabela só tem as colunas que fazem
// sentido para ela. Quem tem carteira E execução aparece nas duas (sem inventar
// terceira categoria). O filtro de período vale SÓ para colaboradores (a carteira
// é foto do agora); por isso ele fica junto daquela tabela, não no topo.
//
// CRITÉRIO ÚNICO de vazio (tabela de colaboradores): sem NENHUM registro no
// período → traço "sem registro no período"; com registro → números reais
// (0,0 h é zero medido de verdade). A tabela de consultores nunca mostra traço:
// suas contagens de carteira são sempre medidas.

function fmtHours(seconds: number): string {
  return toHours(seconds).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function groupBreakdown(slices: CapacityRow["carteiraByGroup"]): string {
  if (slices.length === 0) return "—";
  return slices.map((s) => `${s.count} ${s.name}`).join(" · ");
}

export default function CapacityView({
  rows,
  period,
  drilldownFetcher,
}: {
  rows: CapacityRow[];
  period: CapacityPeriod;
  drilldownFetcher?: DrilldownFetcher; // só a prévia mock injeta; produção usa o default
}) {
  const [query, setQuery] = useState("");
  const [drill, setDrill] = useState<DrilldownTarget | null>(null);

  // Abre o painel de drill-down. Valor zero não abre (célula não é clicável).
  const openDrill = (
    r: CapacityRow,
    scope: DrilldownScope,
    count: number
  ) => {
    if (count <= 0) return;
    setDrill({ personId: r.personId, personName: r.name || "(sem nome)", scope, count, period });
  };

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return rows;
    return rows.filter((r) => norm(r.name ?? "").includes(q));
  }, [rows, query]);

  const consultores = useMemo(
    () => filtered.filter((r) => r.hasCarteira),
    [filtered]
  );
  const colaboradores = useMemo(
    () => filtered.filter((r) => r.isExecutor),
    [filtered]
  );

  return (
    <div className="space-y-6">
      {/* Aviso do topo — UMA linha. As outras ressalvas foram para o rodapé. */}
      <p className="rounded-xl border border-line bg-surface-2/40 px-4 py-2.5 text-sm text-fg-muted">
        <strong className="text-fg">
          Para distribuir carga, não para avaliar desempenho.
        </strong>{" "}
        Sem nota, score ou ranking.
      </p>

      <FilterBar>
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar pessoa…" />
      </FilterBar>

      <ConsultoresTable rows={consultores} empty={rows.length > 0} onOpen={openDrill} />

      <ColaboradoresTable
        rows={colaboradores}
        period={period}
        empty={rows.length > 0}
        onOpen={openDrill}
      />

      {/* RODAPÉ — ressalvas que saíram do topo + legendas. */}
      <div className="space-y-1.5 border-t border-line pt-4 text-xs text-fg-subtle">
        <p>
          <strong>P</strong> = pontuais, <strong>D</strong> = diárias. A
          composição da carteira por grupo aparece sob cada nome (situação atual).
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Os números medem <strong>registro no sistema</strong>. Contato por
            WhatsApp/Digisac não é contabilizado (mesma limitação da tela de
            Acompanhamento).
          </li>
          <li>
            As carteiras <strong>se sobrepõem</strong> (uma empresa pode ter dois
            ou três consultores) — por isso <strong>não somam</strong> num total
            de agência.
          </li>
          <li>
            Tarefas <strong>diárias inflam a contagem</strong> sem representar
            tempo — por isso hora é a medida de carga, e pontual e diária aparecem
            sempre separadas.
          </li>
          <li>
            <strong>Parados</strong> (mais de 15 dias desde o último registro) é o
            sinal de alerta. <strong>Sem registro</strong> não quer dizer cliente
            abandonado: quase sempre é contato feito pela Digisac que não foi ao
            CRM — ausência de registro no sistema, não de atendimento.
          </li>
        </ul>
      </div>

      {drill && (
        <CapacityDrilldownPanel
          target={drill}
          onClose={() => setDrill(null)}
          fetcher={drilldownFetcher}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ CONSULTORES

type ConsultKey =
  | "name"
  | "active"
  | "exclusive"
  | "shared"
  | "alerta"
  | "stalled"
  | "noRecord";

type OpenDrill = (r: CapacityRow, scope: DrilldownScope, count: number) => void;

function ConsultoresTable({
  rows,
  empty,
  onOpen,
}: {
  rows: CapacityRow[];
  empty: boolean;
  onOpen: OpenDrill;
}) {
  const [sort, setSort] = useState<{ key: ConsultKey; desc: boolean }>({
    key: "active",
    desc: true,
  });

  const sorted = useMemo(() => {
    const val = (r: CapacityRow): number | string => {
      switch (sort.key) {
        case "name":
          return norm(r.name ?? "");
        case "active":
          return r.carteiraActive;
        case "exclusive":
          return r.carteiraExclusive;
        case "shared":
          return r.carteiraShared;
        case "alerta":
          return r.carteiraAlerta;
        case "stalled":
          return r.carteiraStalled;
        case "noRecord":
          return r.carteiraNoRecord;
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb), "pt-BR")
          : va - vb;
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, sort]);

  const toggle = (key: ConsultKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">Consultores</h2>
        <p className="text-xs text-fg-subtle">
          Carteira de clientes — inclui administradores com carteira.
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyCard>
          {empty ? "Ninguém com carteira neste recorte." : "Ninguém com carteira ainda."}
        </EmptyCard>
      ) : (
        <TableShell minWidth="48rem">
          <thead>
            <tr className="border-b border-line text-fg-muted">
              <Th align="left" sticky active={sort.key === "name"} desc={sort.desc} onClick={() => toggle("name")}>
                Pessoa
              </Th>
              <Th align="right" active={sort.key === "active"} desc={sort.desc} onClick={() => toggle("active")} title="Clientes ativos na carteira (por exclusão: fora de Cancelados, Pausados e Projetos Finalizados)">
                Ativos
              </Th>
              <Th align="right" active={sort.key === "exclusive"} desc={sort.desc} onClick={() => toggle("exclusive")} title="Clientes ativos atendidos só por esta pessoa">
                Exclusivos
              </Th>
              <Th align="right" active={sort.key === "shared"} desc={sort.desc} onClick={() => toggle("shared")} title="Clientes ativos que têm outro consultor junto">
                Compart.
              </Th>
              <Th align="right" active={sort.key === "alerta"} desc={sort.desc} onClick={() => toggle("alerta")} title="Clientes ativos com a etiqueta ALERTA">
                Alerta
              </Th>
              <Th align="right" active={sort.key === "stalled"} desc={sort.desc} onClick={() => toggle("stalled")} title="Clientes ativos parados: mais de 15 dias desde o último registro de contato (mesmo critério da tela de Acompanhamento)">
                Parados
              </Th>
              <Th align="right" active={sort.key === "noRecord"} desc={sort.desc} onClick={() => toggle("noRecord")} title="Clientes ativos sem nenhum registro de contato no sistema — quase sempre contato feito pela Digisac que não foi ao CRM, não cliente abandonado">
                Sem registro
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.personId} className="border-b border-line/60 align-top last:border-0 hover:bg-surface-2/40">
                <PersonCell r={r} withGroup />
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <Clickable value={r.carteiraActive} onOpen={() => onOpen(r, "ativos", r.carteiraActive)}>
                    <span className="font-semibold text-fg">{r.carteiraActive}</span>
                  </Clickable>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <Clickable value={r.carteiraExclusive} onOpen={() => onOpen(r, "exclusivos", r.carteiraExclusive)}>
                    <span className={r.carteiraExclusive === 0 ? "text-fg-subtle" : "text-fg"}>{r.carteiraExclusive}</span>
                  </Clickable>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <Clickable value={r.carteiraShared} onOpen={() => onOpen(r, "compartilhados", r.carteiraShared)}>
                    <span className={r.carteiraShared === 0 ? "text-fg-subtle" : "text-fg"}>{r.carteiraShared}</span>
                  </Clickable>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <Clickable value={r.carteiraAlerta} onOpen={() => onOpen(r, "alerta", r.carteiraAlerta)}>
                    <Badge value={r.carteiraAlerta} tone="amber" />
                  </Clickable>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <Clickable value={r.carteiraStalled} onOpen={() => onOpen(r, "parados", r.carteiraStalled)}>
                    <Badge value={r.carteiraStalled} tone="rose" dot />
                  </Clickable>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <Clickable value={r.carteiraNoRecord} onOpen={() => onOpen(r, "sem_registro", r.carteiraNoRecord)}>
                    <span className={r.carteiraNoRecord === 0 ? "text-fg-subtle" : "text-fg-muted"}>
                      {r.carteiraNoRecord}
                    </span>
                  </Clickable>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </section>
  );
}

// ----------------------------------------------------------------- COLABORADORES

type ColabKey = "name" | "hours" | "done" | "overdue" | "companies";

function ColaboradoresTable({
  rows,
  period,
  empty,
  onOpen,
}: {
  rows: CapacityRow[];
  period: CapacityPeriod;
  empty: boolean;
  onOpen: OpenDrill;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sort, setSort] = useState<{ key: ColabKey; desc: boolean }>({
    key: "hours",
    desc: true,
  });

  function setPeriod(p: CapacityPeriod) {
    const params = new URLSearchParams(searchParams.toString());
    if (p === "30d") params.delete("periodo");
    else params.set("periodo", p);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const sorted = useMemo(() => {
    const val = (r: CapacityRow): number | string => {
      switch (sort.key) {
        case "name":
          return norm(r.name ?? "");
        case "hours":
          return r.actSeconds;
        case "done":
          return r.actPontualDone;
        case "overdue":
          return r.actOverdue;
        case "companies":
          return r.actCompanies;
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb), "pt-BR")
          : va - vb;
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, sort]);

  const toggle = (key: ColabKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">Colaboradores</h2>
        <p className="text-xs text-fg-subtle">
          Execução no período — quem cronometra tarefas.
        </p>
      </div>

      {/* O período afeta SÓ esta tabela; por isso o filtro mora aqui. */}
      <FilterBar>
        <PeriodTabs period={period} onChange={setPeriod} />
        <span className="self-center text-xs text-fg-subtle">
          O período afeta só esta tabela.
        </span>
      </FilterBar>

      {period === "tudo" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <strong>“Tudo”</strong> é o acumulado histórico — favorece quem está há
          mais tempo na casa. Para comparar carga atual, prefira um período.
        </p>
      )}

      {sorted.length === 0 ? (
        <EmptyCard>
          {empty ? "Ninguém com execução neste recorte." : "Ninguém com execução ainda."}
        </EmptyCard>
      ) : (
        <TableShell minWidth="42rem">
          <thead>
            <tr className="border-b border-line text-fg-muted">
              <Th align="left" sticky active={sort.key === "name"} desc={sort.desc} onClick={() => toggle("name")}>
                Pessoa
              </Th>
              <Th align="right" active={sort.key === "hours"} desc={sort.desc} onClick={() => toggle("hours")} title="Horas trabalhadas no período (pela data real do trabalho), separando pontuais de diárias">
                Horas (P/D)
              </Th>
              <Th align="right" active={sort.key === "done"} desc={sort.desc} onClick={() => toggle("done")} title="Tarefas pontuais concluídas no período">
                Pontuais ✓
              </Th>
              <Th align="right" active={sort.key === "overdue"} desc={sort.desc} onClick={() => toggle("overdue")} title="Tarefas atrasadas (em aberto e vencidas) no período">
                Atrasadas
              </Th>
              <Th align="right" active={sort.key === "companies"} desc={sort.desc} onClick={() => toggle("companies")} title="Empresas distintas com qualquer atividade no período: apontamento de tempo OU tarefa pontual concluída">
                Empresas
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const noReg = !r.actHasActivity;
              return (
                <tr key={r.personId} className="border-b border-line/60 align-top last:border-0 hover:bg-surface-2/40">
                  <PersonCell r={r} />
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {noReg ? (
                      <Dash />
                    ) : (
                      <div className="leading-tight">
                        <div className="font-semibold text-fg">{fmtHours(r.actSeconds)} h</div>
                        <div className="text-[11px] text-fg-subtle">
                          {fmtHours(r.actSecondsPontual)}P · {fmtHours(r.actSecondsDiaria)}D
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {noReg ? <Dash /> : <span className={r.actPontualDone === 0 ? "text-fg-subtle" : "text-fg"}>{r.actPontualDone}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {noReg ? (
                      <Dash />
                    ) : r.actOverdue > 0 ? (
                      <span className="font-medium text-amber-700 dark:text-amber-300">{r.actOverdue}</span>
                    ) : (
                      <span className="text-fg-subtle">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {noReg ? (
                      <Dash />
                    ) : (
                      <Clickable value={r.actCompanies} onOpen={() => onOpen(r, "empresas", r.actCompanies)}>
                        <span className={r.actCompanies === 0 ? "text-fg-subtle" : "text-fg"}>{r.actCompanies}</span>
                      </Clickable>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <p className="text-xs text-fg-subtle">
        “—” = sem nenhum registro no período. “0,0 h” = trabalho medido igual a
        zero.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------- SHARED

// Torna o número clicável (abre o drill-down) quando o valor > 0. Zero não é
// clicável — não abre painel vazio. Sublinhado pontilhado sinaliza "tem lista
// por trás"; é um button (ação dentro de painel/tela, nunca <a> — passo 32.2).
function Clickable({
  value,
  onOpen,
  children,
}: {
  value: number;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  if (value <= 0) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Ver a lista"
      className="rounded underline decoration-dotted decoration-fg-subtle/60 underline-offset-4 transition hover:decoration-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
    >
      {children}
    </button>
  );
}

function TableShell({
  children,
  minWidth,
}: {
  children: React.ReactNode;
  minWidth: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

function PersonCell({ r, withGroup }: { r: CapacityRow; withGroup?: boolean }) {
  const breakdown = groupBreakdown(r.carteiraByGroup);
  return (
    <td className="sticky left-0 z-10 max-w-[17rem] bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Avatar name={r.name || "?"} url={avatarUrl(r.avatarPath)} size={26} />
        <div className="min-w-0">
          <div className="whitespace-nowrap font-medium text-fg">
            {r.name || "(sem nome)"}
          </div>
          {withGroup && (
            <div
              className="mt-0.5 text-[11px] leading-tight text-fg-subtle"
              title={`Carteira por grupo: ${breakdown}`}
            >
              {breakdown}
            </div>
          )}
        </div>
      </div>
    </td>
  );
}

function Badge({
  value,
  tone,
  dot,
}: {
  value: number;
  tone: "amber" | "rose";
  dot?: boolean;
}) {
  if (value === 0) return <span className="text-fg-subtle">0</span>;
  const cls =
    tone === "amber"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />}
      {value}
    </span>
  );
}

function Dash() {
  return (
    <span className="text-fg-subtle" title="Sem registro no período">
      —
    </span>
  );
}

function Th({
  children,
  align,
  sticky,
  active,
  desc,
  onClick,
  title,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  sticky?: boolean;
  active?: boolean;
  desc?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`${sticky ? "sticky left-0 z-10 bg-surface" : ""} px-3 py-2 font-medium`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex w-full items-center gap-1 ${
          align === "right" ? "justify-end" : "justify-start"
        } ${active ? "text-fg" : "text-fg-muted hover:text-fg"} rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd`}
      >
        <span className="whitespace-nowrap">{children}</span>
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0"}`}>
          {desc ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

function PeriodTabs({
  period,
  onChange,
}: {
  period: CapacityPeriod;
  onChange: (p: CapacityPeriod) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Período de análise da atividade"
      className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5"
    >
      {CAPACITY_PERIODS.map((p) => {
        const active = period === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
              active ? "bg-brand-tint text-risd" : "text-fg-muted hover:text-fg"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-fg-subtle shadow-card">
      {children}
    </div>
  );
}
