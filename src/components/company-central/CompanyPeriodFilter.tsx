"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangeField } from "@/components/DateField";
import { MONTHS_PT } from "@/lib/date-picker";
import { monthYearLabel, type PeriodKey, type ResolvedPeriod } from "@/lib/period";

// Filtro de período da CENTRAL DA EMPRESA. Diferente do PeriodFilter simples
// (dashboard/colaborador, só atalhos), este acrescenta MÊS/ANO e INTERVALO livre.
// Os ATALHOS (uso mais frequente) ficam sempre visíveis; o resto entra num
// controle recolhido ("Personalizar") num popover ABSOLUTO — não empurra o
// layout. Com um filtro personalizado ativo, um chip legível mostra o período
// valendo e oferece a volta aos atalhos. A escolha vai para a URL (?periodo=...);
// o servidor resolve e valida (lib/period). Reusa o DateRangeField (mesmo do
// Período do contrato) e o padrão de selects mês/ano do faturamento.

const SHORTCUTS: { value: PeriodKey; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "tudo", label: "Tudo" },
];

// Ano/mês de HOJE em BRT — só para PRÉ-preencher os controles; a fronteira real
// é calculada no servidor a partir da string escolhida. en-CA → "YYYY-MM-DD".
function todayYmdBRT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function CompanyPeriodFilter({ value }: { value: ResolvedPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fecha o "Personalizar" ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Navega preservando os demais parâmetros (aba, fatDe/fatAte…), trocando só o
  // recorte de período: limpa periodo/mes/de/ate e aplica os novos.
  const go = (next: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString());
    for (const k of ["periodo", "mes", "de", "ate"]) sp.delete(k);
    for (const [k, v] of Object.entries(next)) sp.set(k, v);
    setOpen(false);
    router.push(`${pathname}?${sp.toString()}`);
  };

  const custom = value.kind === "mes" || value.kind === "custom";

  // Pré-preenchimento dos controles.
  const curYm = todayYmdBRT().slice(0, 7);
  const seedYm = value.kind === "mes" ? (value.params.mes ?? curYm) : curYm;
  const [selYear, setSelYear] = useState(Number(seedYm.slice(0, 4)));
  const [selMonth, setSelMonth] = useState(Number(seedYm.slice(5, 7)));
  const [rangeStart, setRangeStart] = useState(
    value.kind === "custom" ? value.start ?? "" : ""
  );
  const [rangeEnd, setRangeEnd] = useState(
    value.kind === "custom" ? value.end ?? "" : ""
  );

  const years = useMemo(() => {
    const cy = Number(curYm.slice(0, 4));
    const set = new Set<number>();
    for (let y = cy - 5; y <= cy + 1; y++) set.add(y);
    set.add(selYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [curYm, selYear]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const applyMonth = () => go({ periodo: "mes", mes: `${selYear}-${pad(selMonth)}` });
  const rangeInverted = !!rangeStart && !!rangeEnd && rangeStart > rangeEnd;
  const applyRange = () => {
    if (!rangeStart || !rangeEnd || rangeInverted) return;
    go({ periodo: "custom", de: rangeStart, ate: rangeEnd });
  };

  const sel =
    "rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd";
  const applyBtn =
    "rounded-lg bg-risd px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-risd/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2">
      {/* Chip do filtro personalizado ativo + volta aos atalhos. */}
      {custom && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-risd/40 bg-brand-tint px-3 py-1 text-sm font-medium text-fg">
          <span className="text-fg-muted">
            {value.kind === "mes" ? "Mês:" : "Período:"}
          </span>
          {value.chip}
          <button
            type="button"
            onClick={() => go({ periodo: "30d" })}
            aria-label="Voltar aos atalhos (últimos 30 dias)"
            title="Voltar aos atalhos"
            className="ml-0.5 grid h-4 w-4 place-items-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      )}

      {/* Atalhos (sempre visíveis). */}
      <div
        role="group"
        aria-label="Período"
        className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card"
      >
        {SHORTCUTS.map((o) => {
          const active = !custom && o.value === value.kind;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => go({ periodo: o.value })}
              aria-pressed={active}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${
                active
                  ? "bg-risd text-white shadow-sm"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Botão "Personalizar" — abre o popover. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium shadow-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
          custom
            ? "border-risd/40 bg-brand-tint text-fg"
            : "border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
        Personalizar
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Período personalizado"
          className="absolute right-0 top-full z-overlay mt-2 w-[20rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-4 shadow-pop"
        >
          {/* Mês/ano específico. */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Mês específico
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Mês"
                value={selMonth}
                onChange={(e) => setSelMonth(Number(e.target.value))}
                className={`${sel} flex-1`}
              >
                {MONTHS_PT.map((n, i) => (
                  <option key={i} value={i + 1}>{n}</option>
                ))}
              </select>
              <select
                aria-label="Ano"
                value={selYear}
                onChange={(e) => setSelYear(Number(e.target.value))}
                className={sel}
              >
                {years.map((y) => (<option key={y} value={y}>{y}</option>))}
              </select>
              <button type="button" onClick={applyMonth} className={applyBtn}>
                Aplicar
              </button>
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              {monthYearLabel(`${selYear}-${pad(selMonth)}`)}
            </p>
          </div>

          <div className="my-3 border-t border-line" />

          {/* Intervalo livre (reusa o DateRangeField do Período do contrato). */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Intervalo
            </p>
            <DateRangeField
              startValue={rangeStart}
              endValue={rangeEnd}
              onChange={(s, e) => {
                setRangeStart(s);
                setRangeEnd(e);
              }}
              startLabel="Início"
              endLabel="Fim"
            />
            {rangeInverted && (
              <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
                O início não pode ser depois do fim.
              </p>
            )}
            <button
              type="button"
              onClick={applyRange}
              disabled={!rangeStart || !rangeEnd || rangeInverted}
              className={`mt-2 ${applyBtn}`}
            >
              Aplicar intervalo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
