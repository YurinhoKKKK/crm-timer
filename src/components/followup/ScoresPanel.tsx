"use client";

import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/avatar";
import { FAROL_UI } from "@/components/followup/FarolBadge";
import PeriodPicker from "@/components/PeriodPicker";
import { resolvePeriodValue } from "@/lib/period";
import { getScoresDetail } from "@/app/acompanhamento/actions";
import {
  FOLLOWUP_PERIOD_CONFIG,
  type DayColor,
  type MonthOption,
  type ScoreDetailRow,
  type ScoreMonthRow,
  type UnlinkedCompany,
} from "@/lib/followup";

// Abaixo deste nº de cliente-dias no mês, o aproveitamento é pouco confiável:
// mostramos um selo "amostra pequena" (a pessoa continua na lista).
const SMALL_SAMPLE = 40;

// Aproveitamento (uma casa, pode ser negativo) → "66,9%".
function fmtPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const TZ = "America/Sao_Paulo";
const NONE_KEY = "__none__";

function keyOf(collaboratorId: string | null): string {
  return collaboratorId ?? NONE_KEY;
}

// "YYYY-MM-DD" → "DD" (dia do mês), sem fuso.
function dayNum(day: string): string {
  return day.split("-")[2];
}

// ISO → "HH:MM" (BRT); null → "—".
function hourOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Pontuação por colaborador no mês. Pontos: cor do dia soma +1 (manhã) / 0
// (tarde ou aguardando) / −1 (após 17h ou sem contato), atribuídos ao
// responsável do dia. "Sem responsável" aparece mas não credita ninguém — fica
// por último e de forma apagada. Clicar numa linha abre a grade dia×empresa.
export default function ScoresPanel({
  month,
  monthOptions,
  rows,
  error,
  unlinked,
  consultantId,
  collaboratorId,
  recovering,
}: {
  month: string;
  monthOptions: MonthOption[];
  rows: ScoreMonthRow[];
  error?: string | null;
  // Empresas ativas com colaborador mas sem contato do Digisac (não avaliadas).
  unlinked: UnlinkedCompany[];
  // Filtros aplicados no quadro: o Excel respeita-os (consultor/colaborador na
  // 0156; "Em recuperação" na 0158).
  consultantId: string;
  collaboratorId: string;
  recovering: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Cache por colaborador das grades já buscadas (evita rebater a RPC).
  const [details, setDetails] = useState<Record<string, ScoreDetailRow[]>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const isCurrent = useMemo(
    () => monthOptions.find((m) => m.value === month)?.current ?? false,
    [monthOptions, month]
  );

  // Link do Excel respeita o filtro aplicado no quadro (decisão 4): mês +
  // consultor + colaborador. Os ids vão para a rota, que passa às RPCs.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ mes: month });
    if (consultantId) params.set("consultor", consultantId);
    if (collaboratorId) params.set("colaborador", collaboratorId);
    if (recovering) params.set("recuperacao", "1");
    return `/api/admin/acompanhamento/export?${params.toString()}`;
  }, [month, consultantId, collaboratorId, recovering]);

  // Período (modo mês) resolvido do mês já validado no servidor; o PeriodPicker
  // navega sozinho em ?mes.
  const periodValue = resolvePeriodValue({ mes: month }, FOLLOWUP_PERIOD_CONFIG);

  // Troca de mês invalida as grades abertas (o cache é por chave sem o mês).
  useEffect(() => {
    setOpenKey(null);
    setDetails({});
  }, [month]);

  async function toggle(collaboratorId: string | null) {
    const k = keyOf(collaboratorId);
    if (openKey === k) {
      setOpenKey(null);
      return;
    }
    setOpenKey(k);
    setErrorKey(null);
    if (details[k]) return; // já em cache
    setLoadingKey(k);
    const res = await getScoresDetail(collaboratorId, month);
    setLoadingKey(null);
    if (res.error) {
      setErrorKey(k);
      return;
    }
    setDetails((prev) => ({ ...prev, [k]: res.rows ?? [] }));
  }

  // Separa a linha "sem responsável" para o fim (não pontua ninguém).
  const people = rows.filter((r) => r.collaboratorId !== null);
  const orphan = rows.find((r) => r.collaboratorId === null) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={periodValue} config={FOLLOWUP_PERIOD_CONFIG} />
        {isCurrent && (
          <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            Mês em andamento — ainda muda até o fim do mês
          </span>
        )}
        {/* Download .xlsx do mês — rota com gate is_admin (consultor recebe 403). */}
        <a
          href={exportHref}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Exportar Excel
        </a>
      </div>

      {unlinked.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-medium">
            {unlinked.length}{" "}
            {unlinked.length === 1
              ? "empresa sem contato do Digisac vinculado não está sendo avaliada"
              : "empresas sem contato do Digisac vinculado não estão sendo avaliadas"}
            .
          </p>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs">
            {unlinked.map((c) => (
              <a
                key={c.companyId}
                href={`/admin/empresas/${c.companyId}`}
                className="underline decoration-amber-500/50 underline-offset-2 hover:decoration-amber-500"
              >
                {c.companyName}
              </a>
            ))}
          </p>
        </div>
      )}

      {error ? (
        <div className="rounded-2xl border border-red-300/60 bg-red-50 p-8 text-center text-sm text-red-700 shadow-card dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Não foi possível carregar a pontuação. Tente recarregar a página; se
          persistir, avise o suporte.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-subtle shadow-card">
          Nenhuma pontuação registrada neste mês.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">Colaborador</th>
                <th className="px-3 py-2.5 text-right font-medium">Aproveitamento</th>
                <th className="px-3 py-2.5 text-right font-medium">Pontos</th>
                <th className="px-3 py-2.5 text-right font-medium">Cliente-dias</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Dias verdes (contato de manhã)">Verdes</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Dias amarelos (contato à tarde ou em recuperação)">Amarelos</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Dias vermelhos (sem contato)">Vermelhos</th>
              </tr>
            </thead>
            <tbody>
              {people.map((r) => (
                <ScoreRow
                  key={keyOf(r.collaboratorId)}
                  row={r}
                  open={openKey === keyOf(r.collaboratorId)}
                  loading={loadingKey === keyOf(r.collaboratorId)}
                  error={errorKey === keyOf(r.collaboratorId)}
                  detail={details[keyOf(r.collaboratorId)]}
                  onToggle={() => toggle(r.collaboratorId)}
                />
              ))}
              {orphan && (
                <ScoreRow
                  key={NONE_KEY}
                  row={orphan}
                  orphan
                  open={openKey === NONE_KEY}
                  loading={loadingKey === NONE_KEY}
                  error={errorKey === NONE_KEY}
                  detail={details[NONE_KEY]}
                  onToggle={() => toggle(null)}
                />
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1.5 text-xs text-fg-subtle">
        <p>
          <strong className="text-fg-muted">Aproveitamento</strong> = pontos feitos ÷ chances (1 por cliente por
          dia útil). 100% = todos os clientes verdes todos os dias; 0% = ganhos e perdas se anulam; negativo = mais
          vermelhos que verdes. Não depende do tamanho da carteira.
        </p>
        <p>
          Pontos seguem a cor do cliente: verde{" "}
          <span className="font-medium text-emerald-700 dark:text-emerald-300">+1</span>, em recuperação{" "}
          <span className="font-medium text-amber-700 dark:text-amber-300">0</span>, vermelho{" "}
          <span className="font-medium text-red-700 dark:text-red-300">−1</span>. Depois de um dia vermelho (sem
          contato), são precisos 2 contatos de manhã para o cliente voltar ao verde. Clique num colaborador para ver
          a grade por dia — passe o mouse em cada dia para ver o contato e a cor do cliente.
        </p>
      </div>
    </div>
  );
}

function ScoreRow({
  row,
  orphan,
  open,
  loading,
  error,
  detail,
  onToggle,
}: {
  row: ScoreMonthRow;
  orphan?: boolean;
  open: boolean;
  loading: boolean;
  error: boolean;
  detail: ScoreDetailRow[] | undefined;
  onToggle: () => void;
}) {
  const name = orphan ? "Sem responsável" : row.collaboratorName || "(sem nome)";
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={open}
        className={`cursor-pointer border-b border-line/60 transition hover:bg-surface-2/50 ${
          open ? "bg-surface-2/40" : ""
        } ${orphan ? "text-fg-subtle" : ""}`}
      >
        <td className="px-4 py-2.5">
          <span className="inline-flex items-center gap-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`text-fg-subtle transition ${open ? "rotate-90" : ""}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            {!orphan && (
              <Avatar name={name} url={avatarUrl(row.avatarPath)} size={22} />
            )}
            <span className={orphan ? "italic" : "font-medium text-fg"}>{name}</span>
            {orphan && <span className="text-xs">(não pontua)</span>}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right">
          {orphan ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="inline-flex items-center justify-end gap-1.5">
              {row.clienteDias < SMALL_SAMPLE && (
                <span
                  title={`Amostra pequena: ${row.clienteDias} cliente-dias no mês`}
                  className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                >
                  amostra pequena
                </span>
              )}
              <span
                className={`font-semibold tabular-nums ${
                  row.aproveitamento < 0
                    ? "text-red-700 dark:text-red-300"
                    : "text-fg"
                }`}
              >
                {fmtPct(row.aproveitamento)}
              </span>
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right">
          <span
            className={`tabular-nums ${
              orphan
                ? "text-fg-subtle"
                : row.points > 0
                ? "text-emerald-700 dark:text-emerald-300"
                : row.points < 0
                ? "text-red-700 dark:text-red-300"
                : "text-fg"
            }`}
          >
            {row.points > 0 ? `+${row.points}` : row.points}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{orphan ? "—" : row.clienteDias}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{row.daysVerde}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{row.daysAmarelo}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{row.daysVermelho}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-surface-2/20 px-4 py-3">
            {!orphan && (
              <p className="mb-2 text-xs text-fg-muted">
                Aproveitamento{" "}
                <b className={`tabular-nums ${row.aproveitamento < 0 ? "text-red-700 dark:text-red-300" : "text-fg"}`}>
                  {fmtPct(row.aproveitamento)}
                </b>{" "}
                · Cliente-dias <b className="tabular-nums text-fg">{row.clienteDias}</b> · Pontos{" "}
                <b className="tabular-nums text-fg">{row.points > 0 ? `+${row.points}` : row.points}</b>
                {row.clienteDias < SMALL_SAMPLE && (
                  <span className="ml-1 text-amber-700 dark:text-amber-300">(amostra pequena)</span>
                )}
              </p>
            )}
            {loading ? (
              <p className="text-sm text-fg-subtle">Carregando grade…</p>
            ) : error ? (
              <p className="text-sm text-red-700 dark:text-red-300">
                Não foi possível carregar a grade. Tente novamente.
              </p>
            ) : (
              <ScoreDetailGrid rows={detail ?? []} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Grade dia×empresa: uma linha por empresa, com uma pílula por dia pontuado
// (dia do mês + cor), e o subtotal de pontos da empresa à direita.
function ScoreDetailGrid({ rows }: { rows: ScoreDetailRow[] }) {
  const companies = useMemo(() => {
    const map = new Map<
      string,
      { name: string; days: ScoreDetailRow[]; points: number }
    >();
    for (const r of rows) {
      const g = map.get(r.companyId) ?? { name: r.companyName, days: [], points: 0 };
      g.days.push(r);
      g.points += r.points;
      map.set(r.companyId, g);
    }
    // Já vem ordenado por nome, dia; preserva a ordem de inserção.
    return Array.from(map.values());
  }, [rows]);

  // Contagens de evento no mês (decisão 6): clientes que ficaram vermelhos,
  // recuperados (empresas distintas) e recaídas (eventos).
  const counts = useMemo(() => {
    const vermelhos = new Set<string>();
    const recuperados = new Set<string>();
    let recaidas = 0;
    for (const r of rows) {
      if (r.evento === "Ficou vermelho") vermelhos.add(r.companyId);
      else if (r.evento === "Recuperado") recuperados.add(r.companyId);
      else if (r.evento === "Recaiu") recaidas += 1;
    }
    return { vermelhos: vermelhos.size, recuperados: recuperados.size, recaidas };
  }, [rows]);

  if (companies.length === 0) {
    return <p className="text-sm text-fg-subtle">Nenhum dia pontuado neste mês.</p>;
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span>Ficaram vermelhos: <b className="tabular-nums text-fg">{counts.vermelhos}</b></span>
        <span>Recuperados: <b className="tabular-nums text-fg">{counts.recuperados}</b></span>
        <span>Recaídas: <b className="tabular-nums text-fg">{counts.recaidas}</b></span>
      </div>
      <ul className="space-y-2">
      {companies.map((c) => (
        <li
          key={c.name}
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-surface px-3 py-2"
        >
          <span className="mr-auto min-w-0 truncate text-sm font-medium text-fg" title={c.name}>
            {c.name}
          </span>
          <span className="flex flex-wrap gap-1">
            {c.days.map((d) => (
              <DayPill key={d.day} day={d} />
            ))}
          </span>
          <span
            className={`w-12 shrink-0 text-right text-sm font-semibold tabular-nums ${
              c.points > 0
                ? "text-emerald-700 dark:text-emerald-300"
                : c.points < 0
                ? "text-red-700 dark:text-red-300"
                : "text-fg-muted"
            }`}
          >
            {c.points > 0 ? `+${c.points}` : c.points}
          </span>
        </li>
      ))}
      </ul>
    </>
  );
}

function DayPill({ day }: { day: ScoreDetailRow }) {
  // A pílula usa a COR DO CLIENTE (a que pontua); o tooltip traz o contato do dia
  // e a cor do cliente (decisão 6), além do horário e dos pontos.
  const ui = FAROL_UI[day.color as DayColor];
  const pts = day.points > 0 ? `+${day.points}` : String(day.points);
  const [, m, d] = day.day.split("-");
  const contato =
    day.contactColor === "aguardando"
      ? "aguardando"
      : `${day.contactColor}${day.firstMsgAt ? " " + hourOf(day.firstMsgAt) : ""}`;
  const cliente = `${day.color}${day.recoveryNeed > 0 ? " (em recuperação)" : ""}`;
  const title = `${d}/${m} · contato: ${contato} · cliente: ${cliente} · ${pts} pt`;
  return (
    <span
      title={title}
      className={`inline-flex min-w-[1.9rem] items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${ui.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} aria-hidden="true" />
      {dayNum(day.day)}
    </span>
  );
}
