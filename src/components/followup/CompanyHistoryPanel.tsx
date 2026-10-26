"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MonthSelect from "@/components/followup/MonthSelect";
import { FAROL_UI } from "@/components/followup/FarolBadge";
import { getCompanyHistory } from "@/app/acompanhamento/actions";
import type { CompanyHistory, DayColor, MonthOption } from "@/lib/followup";

const TZ = "America/Sao_Paulo";

// "YYYY-MM-DD" → "DD/MM · ter" (sem fuso).
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short" }).replace(".", "");
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${wd}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// Painel lateral "Histórico do contato" (decisão 5): resumo no topo + linha do
// tempo do mês (mais recente em cima), com seletor de mês igual ao do quadro.
// Fim de semana e feriado não aparecem (o banco só devolve dias com linha).
export default function CompanyHistoryPanel({
  companyId,
  companyName,
  companyHref,
  initialMonth,
  monthOptions,
  onClose,
}: {
  companyId: string;
  companyName: string;
  companyHref: string;
  initialMonth: string;
  monthOptions: MonthOption[];
  onClose: () => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<CompanyHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      const res = await getCompanyHistory(companyId, month);
      if (!active) return;
      if (res.error) setError(res.error);
      else setData(res.data ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [companyId, month]);

  // Fecha no Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-sheet flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={`Histórico do contato — ${companyName}`}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-pop"
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Histórico do contato
            </p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-fg" title={companyName}>
              {companyName}
            </h2>
            <Link
              href={companyHref}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-risd hover:underline"
            >
              Abrir empresa
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </Link>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Seletor de mês */}
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <span className="text-xs text-fg-muted">Mês</span>
          <MonthSelect
            id={`hist-mes-${companyId}`}
            month={month}
            options={monthOptions}
            onChange={setMonth}
            ariaLabel="Mês do histórico"
          />
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-fg-subtle">Carregando histórico…</p>
          ) : error ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              Não foi possível carregar o histórico. Tente novamente.
            </p>
          ) : !data || data.days.length === 0 ? (
            <p className="text-sm text-fg-subtle">Sem dias pontuados neste mês.</p>
          ) : (
            <>
              {/* Resumo */}
              <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                <p className="text-sm font-medium text-fg">{data.summary.situacao}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                  <span>Dias vermelhos: <b className="tabular-nums text-fg">{data.summary.reds}</b></span>
                  <span>Recaídas: <b className="tabular-nums text-fg">{data.summary.relapses}</b></span>
                  <span>Recuperações: <b className="tabular-nums text-fg">{data.summary.recoveries}</b></span>
                </div>
              </div>

              {/* Linha do tempo */}
              <ol className="mt-4 space-y-2">
                {data.days.map((day) => (
                  <TimelineRow key={day.d} day={day} />
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({
  day,
}: {
  day: CompanyHistory["days"][number];
}) {
  const client = FAROL_UI[day.color as DayColor];
  const contact = FAROL_UI[day.contactColor as DayColor];
  const pts = day.points > 0 ? `+${day.points}` : String(day.points);
  return (
    <li className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${client.dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tabular-nums text-fg">{fmtDay(day.d)}</span>
          <span
            className={`shrink-0 tabular-nums text-xs font-semibold ${
              day.points > 0
                ? "text-emerald-700 dark:text-emerald-300"
                : day.points < 0
                ? "text-red-700 dark:text-red-300"
                : "text-fg-subtle"
            }`}
          >
            {pts} pt
          </span>
        </div>
        {day.evento && <p className="mt-0.5 text-sm text-fg">{day.evento}</p>}
        <p className="mt-0.5 text-xs text-fg-subtle">
          {day.contactColor === "aguardando" ? (
            "Aguardando contato"
          ) : day.firstMsgAt ? (
            <>Contato às <span className="tabular-nums">{fmtTime(day.firstMsgAt)}</span> ({contact.label.toLowerCase()})</>
          ) : (
            "Sem contato"
          )}
          {" · "}cliente {client.label.toLowerCase()}
        </p>
      </div>
    </li>
  );
}
