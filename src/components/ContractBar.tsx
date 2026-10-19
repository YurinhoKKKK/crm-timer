"use client";

import {
  computeContractBar,
  computePeriodInfo,
  formatPureDate,
  todayBRT,
} from "@/lib/company-details";
import { shiftIso } from "@/lib/date-picker";

// Barra visual do período do contrato — MESMO componente na lista de empresas
// (compact) e no cabeçalho da página da empresa. No espírito da coluna Timeline
// do Monday, mas com a identidade visual do projeto.
//
// Só desenha quando as DUAS datas existem (computeContractBar devolve null caso
// contrário → nada é renderizado, a linha fica como está). Datas são DATA PURA:
// toda a conta é em Date.UTC / string, sem new Date(string) e sem fuso; o "hoje"
// é a data corrente em Brasília (todayBRT).

const dayWord = (n: number) => (Math.abs(n) === 1 ? "dia" : "dias");

// Texto do tooltip (detalhe completo): início, fim, total e restante/encerrado.
// `effEnd` é o fim EFETIVO (com a pausa somada); quando há pausa, mostra também o
// fim contratado e os dias pausados.
function buildTitle(
  startedOn: string,
  effEnd: string,
  originalEnd: string,
  pausedDays: number
): string {
  const info = computePeriodInfo(startedOn, effEnd, todayBRT());
  if (info.state !== "full") return "";
  const parts = [`Início: ${formatPureDate(info.startedOn)}`];
  if (pausedDays > 0) {
    parts.push(`Fim efetivo: ${formatPureDate(info.endsOn)}`);
    parts.push(`Contratado: ${formatPureDate(originalEnd)}`);
    parts.push(`+${pausedDays} ${dayWord(pausedDays)} de pausa`);
  } else {
    parts.push(`Fim: ${formatPureDate(info.endsOn)}`);
  }
  parts.push(`${info.totalDays} ${dayWord(info.totalDays)} no total`);
  if (info.ended) parts.push("Encerrado");
  else if (info.remaining === 0) parts.push("Encerra hoje");
  else parts.push(`Faltam ${info.remaining} ${dayWord(info.remaining)}`);
  return parts.join(" · ");
}

export default function ContractBar({
  startedOn,
  endsOn,
  compact = false,
  // Variante "board" (quadro de Tráfego): SEM o rótulo "Contrato" (o cabeçalho da
  // coluna já diz) — barra fina em cima e UMA linha, sem quebra, com um prefixo
  // opcional ("12 meses") + o texto de dias: "12 meses · faltam 364 dias".
  board = false,
  prefix,
  // Dias pausados (contrato em pausa). Quando > 0 e há endsOn, a barra passa a
  // refletir o FIM EFETIVO (endsOn + pausa); o tooltip mostra contratado + pausa.
  pausedDays = 0,
}: {
  startedOn: string | null;
  endsOn: string | null;
  compact?: boolean;
  board?: boolean;
  prefix?: string;
  pausedDays?: number;
}) {
  const effEnd =
    endsOn && pausedDays > 0 ? shiftIso(endsOn, pausedDays) : endsOn;
  const bar = computeContractBar(startedOn, effEnd, todayBRT());
  if (!bar) return null;
  const title =
    startedOn && effEnd
      ? buildTitle(startedOn, effEnd, endsOn as string, pausedDays)
      : "";

  let percent = 0;
  let fillClass = "bg-risd";
  let label = "";
  let labelClass = "text-fg-muted";

  if (bar.state === "not_started") {
    percent = 0;
    label = `começa em ${bar.startsInDays} ${dayWord(bar.startsInDays)}`;
    labelClass = "text-fg-subtle";
  } else if (bar.state === "ended") {
    percent = 100;
    fillClass = "bg-fg-subtle";
    label = `encerrado há ${bar.endedDaysAgo} ${dayWord(bar.endedDaysAgo)}`;
    labelClass = "text-fg-subtle";
  } else {
    percent = bar.percent;
    if (bar.nearEnd) {
      // Perto do fim (≤30 dias): destaque — sinal de renovação, o mais acionável.
      fillClass = "bg-amber-500";
      labelClass = "font-medium text-amber-700 dark:text-amber-400";
      label =
        bar.remaining === 0
          ? "encerra hoje"
          : `faltam ${bar.remaining} ${dayWord(bar.remaining)}`;
    } else {
      label = `faltam ${bar.remaining} ${dayWord(bar.remaining)}`;
    }
  }

  const trackH = compact ? "h-1.5" : "h-2";
  const labelSize = compact ? "text-[11px]" : "text-xs";

  // Variante do quadro de Tráfego: barra fina + uma linha única (sem rótulo
  // "Contrato", sem quebra).
  if (board) {
    return (
      <div title={title} className="min-w-0">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Período do contrato: ${label}`}
        >
          <div
            className={`h-full rounded-full transition-all ${fillClass}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className={`mt-1 truncate text-[11px] ${labelClass}`}>
          {prefix ? `${prefix} · ${label}` : label}
        </div>
      </div>
    );
  }

  return (
    <div
      title={title}
      className={compact ? "max-w-[240px]" : "max-w-sm"}
    >
      <div className={`mb-1 flex items-center justify-between gap-2 ${labelSize}`}>
        <span className="text-fg-subtle">
          {compact ? "Contrato" : "Período do contrato"}
        </span>
        <span className={labelClass}>{label}</span>
      </div>
      <div
        className={`w-full overflow-hidden rounded-full bg-surface-2 ${trackH}`}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Período do contrato: ${label}`}
      >
        <div
          className={`h-full rounded-full transition-all ${fillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
