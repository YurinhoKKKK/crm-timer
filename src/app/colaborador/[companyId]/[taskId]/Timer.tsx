"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskStatus, ListingMarketplace } from "@/lib/types";
import type { ListingBrandRef, ListingResultView } from "@/lib/listing";
import { marketplaceLabel } from "@/lib/listing";
import ListingResultsView from "@/components/ListingResultsView";
import {
  startTimer,
  pauseTimer,
  finishTask,
  finishListingTask,
  type ListingResultInput,
} from "../../actions";

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function comboKey(brandId: string, mk: ListingMarketplace): string {
  return `${brandId}|${mk}`;
}

export default function Timer({
  taskId,
  companyId,
  status,
  totalSeconds,
  openStartedAt,
  completionNote,
  listing,
  listingResults,
}: {
  taskId: string;
  companyId: string;
  status: TaskStatus;
  totalSeconds: number;
  openStartedAt: string | null;
  completionNote: string | null;
  // Quando presente, a tarefa é uma LISTAGEM: a finalização captura os links por
  // combinação marca × marketplace (passo 22.1), não o resumo simples.
  listing?: { brands: ListingBrandRef[]; marketplaces: ListingMarketplace[] } | null;
  // Resultados já capturados (para exibir na tarefa finalizada).
  listingResults?: ListingResultView[];
}) {
  const router = useRouter();
  const isListing = !!listing;
  const [localStatus, setLocalStatus] = useState<TaskStatus>(status);
  const [base, setBase] = useState(totalSeconds);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(
    openStartedAt ? Date.parse(openStartedAt) : null
  );
  const running = startedAtMs !== null;

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Estado da captura de links da listagem (uma entrada por marca × marketplace).
  const [linkByKey, setLinkByKey] = useState<Record<string, string>>({});
  const [notDoneByKey, setNotDoneByKey] = useState<Record<string, boolean>>({});
  const [reasonByKey, setReasonByKey] = useState<Record<string, string>>({});

  const combos = listing
    ? listing.brands.flatMap((b) =>
        listing.marketplaces.map((mk) => ({
          key: comboKey(b.id, mk),
          brandId: b.id,
          brandName: b.name,
          marketplace: mk,
        }))
      )
    : [];

  // Cada combinação precisa de link OU (não feita + justificativa).
  const listingValid =
    combos.length > 0 &&
    combos.every((c) => {
      if (notDoneByKey[c.key]) return (reasonByKey[c.key] ?? "").trim().length > 0;
      return (linkByKey[c.key] ?? "").trim().length > 0;
    });

  // Tique de 1s enquanto rodando (o tempo autoritativo vem do servidor ao pausar).
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed =
    base + (running && startedAtMs ? (nowMs - startedAtMs) / 1000 : 0);

  const finalized = localStatus === "finalizada";
  const canceled = localStatus === "cancelada";

  async function handleStart() {
    setError(null);
    setBusy(true);
    const { error: err, startedAt } = await startTimer(taskId);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setStartedAtMs(startedAt ? Date.parse(startedAt) : Date.now());
    setLocalStatus("iniciada");
    startTransition(() => router.refresh());
  }

  async function handlePause() {
    setError(null);
    setBusy(true);
    const { error: err, totalSeconds: total } = await pauseTimer(taskId);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (typeof total === "number") setBase(total);
    setStartedAtMs(null);
    startTransition(() => router.refresh());
  }

  async function handleFinish(send: boolean) {
    setError(null);
    setWarning(null);
    setBusy(true);
    const {
      error: err,
      totalSeconds: total,
      warning: warn,
    } = await finishTask(taskId, companyId, note, send);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (typeof total === "number") setBase(total);
    setStartedAtMs(null);
    setLocalStatus("finalizada");
    setFinishing(false);
    if (warn) setWarning(warn);
    startTransition(() => router.refresh());
  }

  async function handleFinishListing(send: boolean) {
    setError(null);
    setWarning(null);
    const results: ListingResultInput[] = combos.map((c) =>
      notDoneByKey[c.key]
        ? {
            brandId: c.brandId,
            brandName: c.brandName,
            marketplace: c.marketplace,
            reason: reasonByKey[c.key],
          }
        : {
            brandId: c.brandId,
            brandName: c.brandName,
            marketplace: c.marketplace,
            link: linkByKey[c.key],
          }
    );
    setBusy(true);
    const {
      error: err,
      totalSeconds: total,
      warning: warn,
    } = await finishListingTask(taskId, companyId, results, note, send);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (typeof total === "number") setBase(total);
    setStartedAtMs(null);
    setLocalStatus("finalizada");
    setFinishing(false);
    if (warn) setWarning(warn);
    startTransition(() => router.refresh());
  }

  // --- Tarefa já encerrada -------------------------------------------------
  if (finalized || canceled) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              finalized
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-surface-2 text-fg-subtle"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                finalized ? "bg-emerald-500" : "bg-fg-subtle"
              }`}
            />
            {finalized ? "Finalizada" : "Cancelada"}
          </span>
          <span className="text-sm text-fg-muted">
            Tempo total:{" "}
            <span className="font-mono tabular-nums text-fg">
              {formatClock(base)}
            </span>
          </span>
        </div>
        {finalized && isListing && listingResults && listingResults.length > 0 && (
          <ListingResultsView results={listingResults} className="mt-4" />
        )}
        {finalized && (completionNote || note) && (
          <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Resumo
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-fg">
              {completionNote || note}
            </p>
          </div>
        )}
        {warning && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {warning}
          </p>
        )}
      </section>
    );
  }

  // --- Timer ativo ---------------------------------------------------------
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* Mostrador do cronômetro */}
      <div
        className={`relative flex flex-col items-center px-4 py-10 transition-colors sm:px-6 ${
          running
            ? "bg-gradient-to-b from-brand-tint to-surface"
            : "bg-surface"
        }`}
      >
        <span className="text-xs font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Tempo
        </span>
        <span
          className="mt-2 font-mono text-5xl font-semibold tabular-nums text-risd sm:text-6xl md:text-7xl"
          aria-live="off"
        >
          {formatClock(elapsed)}
        </span>
        <span
          className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${
            running ? "text-risd" : "text-fg-subtle"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              running ? "animate-pulse bg-risd" : "bg-fg-subtle"
            }`}
          />
          {running ? "Em andamento" : "Pausado"}
        </span>
      </div>

      <div className="border-t border-line p-6">
        {!finishing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            {!running ? (
              <button
                type="button"
                onClick={handleStart}
                disabled={busy}
                className="w-full rounded-xl bg-risd px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {base > 0 ? "Retomar" : "Iniciar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePause}
                disabled={busy}
                className="w-full rounded-xl border border-risd bg-surface px-7 py-3 text-sm font-semibold text-risd shadow-sm transition hover:bg-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Pausar
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setFinishing(true);
              }}
              disabled={busy}
              className="w-full rounded-xl bg-chrysler px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chrysler focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Finalizar
            </button>
          </div>
        ) : isListing ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-fg">
              Links das listagens <span className="text-red-500">*</span>
            </p>
            <p className="mb-3 text-xs text-fg-subtle">
              Para cada marca e marketplace, cole o link da planilha ou marque
              como não feita com uma justificativa.
            </p>
            <ul className="space-y-3">
              {combos.map((c) => {
                const notDone = !!notDoneByKey[c.key];
                return (
                  <li
                    key={c.key}
                    className="rounded-xl border border-line bg-surface-2 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {c.brandName}
                      </span>
                      <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg-muted">
                        {marketplaceLabel(c.marketplace)}
                      </span>
                      <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
                        <input
                          type="checkbox"
                          className="accent-risd"
                          checked={notDone}
                          onChange={(e) =>
                            setNotDoneByKey((prev) => ({
                              ...prev,
                              [c.key]: e.target.checked,
                            }))
                          }
                        />
                        Não foi feita
                      </label>
                    </div>
                    {notDone ? (
                      <input
                        type="text"
                        value={reasonByKey[c.key] ?? ""}
                        onChange={(e) =>
                          setReasonByKey((prev) => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }))
                        }
                        placeholder="Justificativa (ex.: marca sem relevância)"
                        className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      />
                    ) : (
                      <input
                        type="url"
                        inputMode="url"
                        value={linkByKey[c.key] ?? ""}
                        onChange={(e) =>
                          setLinkByKey((prev) => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }))
                        }
                        placeholder="https://link-da-planilha…"
                        className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <label
              htmlFor="listing-note"
              className="mb-1.5 mt-4 block text-sm font-medium text-fg"
            >
              Resumo <span className="text-fg-subtle">(opcional)</span>
            </label>
            <textarea
              id="listing-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observações (opcional)…"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
              <button
                type="button"
                onClick={() => handleFinishListing(true)}
                disabled={busy || !listingValid}
                className="w-full rounded-xl bg-chrysler px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chrysler focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Finalizar e enviar ao WhatsApp
              </button>
              <button
                type="button"
                onClick={() => handleFinishListing(false)}
                disabled={busy || !listingValid}
                className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Finalizar e apenas salvar no registro
              </button>
              <button
                type="button"
                onClick={() => setFinishing(false)}
                disabled={busy}
                className="w-full rounded-xl px-4 py-3 text-sm text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:w-auto"
              >
                Cancelar
              </button>
            </div>
            <p className="mt-3 text-xs text-fg-subtle">
              Os links ficam visíveis na aba &quot;Minhas Listagens&quot; e para o
              cliente. O resumo em texto, se preenchido, segue a escolha de enviar
              ao WhatsApp.
            </p>
          </div>
        ) : (
          <div>
            <label
              htmlFor="completion-note"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Resumo do que foi feito <span className="text-red-500">*</span>
            </label>
            <textarea
              id="completion-note"
              rows={4}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Descreva o que foi realizado nesta tarefa…"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm transition placeholder:text-fg-subtle focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              autoFocus
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
              <button
                type="button"
                onClick={() => handleFinish(true)}
                disabled={busy || note.trim().length === 0}
                className="w-full rounded-xl bg-chrysler px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-chrysler/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chrysler focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Finalizar e enviar ao WhatsApp
              </button>
              <button
                type="button"
                onClick={() => handleFinish(false)}
                disabled={busy || note.trim().length === 0}
                className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Finalizar e apenas salvar no registro
              </button>
              <button
                type="button"
                onClick={() => setFinishing(false)}
                disabled={busy}
                className="w-full rounded-xl px-4 py-3 text-sm text-fg-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:w-auto"
              >
                Cancelar
              </button>
            </div>
            <p className="mt-3 text-xs text-fg-subtle">
              &quot;Enviar ao WhatsApp&quot; dispara o resumo ao grupo vinculado à
              empresa. Se a empresa não tiver grupo, a tarefa é finalizada mesmo
              assim e um aviso é exibido.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
