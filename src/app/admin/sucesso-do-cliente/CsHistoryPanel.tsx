"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { csStatusShort, CS_AUDIT_PAGE } from "@/lib/cs-status";
import { fetchCsAudit, type CsAuditEntry } from "./actions";

function roleLabel(role: CsAuditEntry["subjectRole"]): string {
  if (role === "ambos") return "Consultor e Colaborador";
  if (role === "consultor") return "Consultor";
  if (role === "colaborador") return "Colaborador";
  return "";
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA' por recorte de texto (sem Date, sem fuso).
function dateBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

// Data+hora do registro em horário de Brasília.
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function money(v: string | null): string {
  if (v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? BRL.format(n) : v;
}

// Monta a frase do registro. Trata criar (de nada), limpar (para nada) e alterar.
// changed_by nulo (integração/SQL avulso) → "Sistema".
function describe(e: CsAuditEntry): string {
  const by = e.changedByName ?? "Sistema";
  const isDate =
    e.field === "data_reuniao" || e.field === "data_entrada" || e.field === "data_fim";
  const fmt = (v: string | null) => {
    if (isDate) return dateBR(v);
    if (e.field === "valor_projeto") return money(v);
    if (e.field === "parcelas") return v ?? "";
    return csStatusShort(v); // nps_geral / nps_pessoa
  };

  let noun: string;
  switch (e.field) {
    case "nps_pessoa": {
      const r = roleLabel(e.subjectRole);
      noun = `o NPS de ${e.subjectName ?? "(usuário removido)"}${r ? ` (${r})` : ""}`;
      break;
    }
    case "nps_geral":
      noun = "o NPS geral";
      break;
    case "data_reuniao":
      noun = "a Data da Reunião";
      break;
    case "valor_projeto":
      noun = "o valor do projeto";
      break;
    case "parcelas":
      noun = "as parcelas";
      break;
    case "data_entrada":
      noun = "a Data de Entrada";
      break;
    case "data_fim":
      noun = "o fim do contrato";
      break;
    default:
      noun = "o campo";
  }

  if (e.oldValue == null && e.newValue != null) {
    return `${by} definiu ${noun} como ${fmt(e.newValue)}`;
  }
  if (e.oldValue != null && e.newValue == null) {
    return `${by} limpou ${noun} (era ${fmt(e.oldValue)})`;
  }
  if (e.oldValue != null && e.newValue != null) {
    return `${by} alterou ${noun} de ${fmt(e.oldValue)} para ${fmt(e.newValue)}`;
  }
  return `${by} atualizou ${noun}`;
}

export default function CsHistoryPanel({
  companyId,
  companyName,
  onClose,
}: {
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CsAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      const res = await fetchCsAudit(companyId, offset);
      return res;
    },
    [companyId]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load(0)
      .then((res) => {
        if (!active) return;
        setEntries(res.entries);
        setHasMore(res.hasMore);
      })
      .catch(() => active && setError("Não foi possível carregar o histórico."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await load(entries.length);
      setEntries((prev) => [...prev, ...res.entries]);
      setHasMore(res.hasMore);
    } catch {
      setError("Não foi possível carregar mais.");
    } finally {
      setLoadingMore(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-overlay flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico de ${companyName}`}
        className="relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-pop sm:w-[34rem] sm:max-w-[90vw]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              Histórico — Sucesso do Cliente
            </p>
            <h2 className="truncate text-lg font-semibold text-fg">{companyName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-fg-subtle">Carregando…</p>
          ) : error ? (
            <p role="alert" className="py-8 text-center text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface-2/30 p-6 text-center text-sm text-fg-subtle">
              Nenhuma alteração registrada ainda.
            </p>
          ) : (
            <>
              <ol className="space-y-2">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg shadow-card"
                  >
                    <span>{describe(e)}</span>
                    <span className="mt-0.5 block text-xs tabular-nums text-fg-subtle">
                      {fmtWhen(e.changedAtISO)}
                    </span>
                  </li>
                ))}
              </ol>
              {hasMore && (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition hover:border-risd/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:opacity-60"
                  >
                    {loadingMore ? "Carregando…" : `Carregar mais ${CS_AUDIT_PAGE}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
