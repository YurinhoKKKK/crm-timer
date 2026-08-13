"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { btnPrimary, btnSecondary, labelClass } from "@/lib/ui";
import { saveRevenueMonth, fetchRevenueMonth } from "@/app/revenue-actions";
import {
  SALES_CHANNELS,
  CHANNEL_LABEL,
  isoMonth,
  monthLabel,
  yearOf,
  monthNumberOf,
  toInputBR,
  type RevenueMonth,
  type SalesChannel,
} from "@/lib/revenue";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const selectClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

// Formulário de lançamento do MÊS inteiro (passo Fatia 1). Um campo por canal
// ATIVO da empresa, para lançar tudo de uma vez; observação opcional. O UPSERT
// corrige o mês se já existir — então este mesmo formulário serve para "Lançar"
// e para "Editar" (pré-preenchido). Trocar o mês selecionado recarrega os
// valores daquele mês (evita apagar sem querer o que já existe).
export default function RevenueForm({
  open,
  onClose,
  companyId,
  activeChannels,
  months,
  currentMonth,
  initialMonth,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  activeChannels: SalesChannel[];
  months: RevenueMonth[];
  currentMonth: string;
  // Mês pré-selecionado ao abrir ("YYYY-MM-01"): corrente ao "Lançar", ou um
  // mês específico ao "Editar".
  initialMonth: string;
  onSaved: () => void;
}) {
  const [year, setYear] = useState(() => yearOf(initialMonth || currentMonth));
  const [month, setMonth] = useState(() =>
    monthNumberOf(initialMonth || currentMonth)
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthByIso = useMemo(() => {
    const map = new Map<string, RevenueMonth>();
    for (const m of months) map.set(m.month, m);
    return map;
  }, [months]);

  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    const cy = yearOf(currentMonth || initialMonth);
    for (let y = cy - 5; y <= cy + 1; y++) set.add(y);
    for (const m of months) set.add(yearOf(m.month));
    set.add(yearOf(initialMonth || currentMonth));
    return Array.from(set).sort((a, b) => b - a);
  }, [months, currentMonth, initialMonth]);

  // Ao (re)abrir, posiciona no mês pedido.
  useEffect(() => {
    if (!open) return;
    setYear(yearOf(initialMonth || currentMonth));
    setMonth(monthNumberOf(initialMonth || currentMonth));
    setError(null);
  }, [open, initialMonth, currentMonth]);

  // Sempre que o mês selecionado muda, carrega os valores daquele mês (ou limpa
  // se for um mês novo). Assim editar um mês já lançado vem pré-preenchido, e
  // trocar de mês nunca deixa valores de outro mês para trás.
  //
  // O mês pode NÃO estar no cache `months` (que, com filtro por período ativo,
  // traz só o intervalo). Nesse caso buscamos os valores AUTORITATIVOS no banco
  // antes de exibir — caso contrário abriríamos vazio e salvar apagaria os
  // lançamentos existentes do mês. Enquanto busca, o botão Salvar fica travado.
  const selectedIso = isoMonth(year, month);
  useEffect(() => {
    if (!open) return;

    const fill = (
      channels: Partial<Record<SalesChannel, number>>,
      noteText: string | null
    ) => {
      const next: Record<string, string> = {};
      for (const ch of SALES_CHANNELS) {
        const v = channels[ch.value];
        next[ch.value] = v === undefined ? "" : toInputBR(v);
      }
      setValues(next);
      setNote(noteText ?? "");
    };

    const cached = monthByIso.get(selectedIso);
    if (cached) {
      // Mês visível no intervalo carregado: pré-preenche na hora.
      fill(cached.channels, cached.note);
      setLoading(false);
      return;
    }

    // Mês fora do intervalo carregado: busca a verdade no banco antes de exibir.
    let active = true;
    setLoading(true);
    fetchRevenueMonth(companyId, selectedIso).then((res) => {
      if (!active) return;
      fill(res?.channels ?? {}, res?.note ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedIso, monthByIso]);

  if (activeChannels.length === 0) return null;

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    const rawEntries = activeChannels.map((channel) => ({
      channel,
      raw: values[channel] ?? "",
    }));
    const res = await saveRevenueMonth(companyId, selectedIso, rawEntries, note);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="revenue-form-title" maxWidth="max-w-lg">
      <div className="space-y-5">
        <div>
          <h2 id="revenue-form-title" className="text-lg font-semibold text-fg">
            Lançar faturamento — {monthLabel(selectedIso)}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Faturamento <strong className="font-semibold text-fg">bruto</strong>{" "}
            (antes de taxas e comissões).
          </p>
        </div>

        {/* Mês e ano — nunca campo de texto livre. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="rev-month" className={labelClass}>
              Mês
            </label>
            <select
              id="rev-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className={selectClass}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rev-year" className={labelClass}>
              Ano
            </label>
            <select
              id="rev-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className={selectClass}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Um valor por canal ativo. */}
        <div className="space-y-3">
          {activeChannels.map((channel) => (
            <div key={channel}>
              <label htmlFor={`rev-${channel}`} className={labelClass}>
                {CHANNEL_LABEL[channel]}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
                  R$
                </span>
                <input
                  id={`rev-${channel}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={values[channel] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [channel]: e.target.value }))
                  }
                  placeholder="0,00"
                  className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-right text-sm tabular-nums text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                />
              </div>
            </div>
          ))}
          <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-fg-muted">
            Deixe em branco para{" "}
            <strong className="font-semibold text-fg">sem registro</strong>{" "}
            naquele canal. Digite{" "}
            <strong className="font-semibold text-fg">0</strong> para registrar
            faturamento zero. Use o padrão brasileiro (ex.: 118.400,50).
          </p>
        </div>

        <div>
          <label htmlFor="rev-note" className={labelClass}>
            Observação do mês{" "}
            <span className="font-normal text-fg-subtle">(opcional)</span>
          </label>
          <textarea
            id="rev-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            rows={2}
            placeholder="Ex.: campanha de dia das mães, ruptura de estoque…"
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          />
          <p className="mt-1 text-right text-xs text-fg-subtle">
            {note.length}/280
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || loading}
            className={btnPrimary}
          >
            {saving ? "Salvando…" : loading ? "Carregando…" : "Salvar mês"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
