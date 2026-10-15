import type { DigisacSyncStatus } from "@/lib/digisac-sync";

// Quadro "Sincronização Digisac" (etapa 1) — server component, só leitura.
// Última execução, status, mensagens gravadas, progresso da carga do histórico
// (contatos com cursor x total) e último erro. Cor nunca é o único sinal (há rótulo).

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  parcial: { label: "Parcial (continua na próxima)", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  erro: { label: "Erro", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
};

export default function DigisacSyncCard({ status }: { status: DigisacSyncStatus }) {
  const { lastRun, contactsWithCursor, totalContacts, totalMessages } = status;
  const loadDone = totalContacts > 0 && contactsWithCursor >= totalContacts;
  const st = lastRun?.status ? STATUS_LABEL[lastRun.status] : null;

  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-fg">Sincronização Digisac</h2>
        {st ? (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
            {st.label}
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-fg-muted">
            sem execução ainda
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-fg-subtle">Última execução</dt>
          <dd className="text-fg">{fmt(lastRun?.finished_at ?? lastRun?.started_at ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Gravadas (última)</dt>
          <dd className="tabular-nums text-fg">{lastRun?.messages_upserted ?? 0}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Mensagens no banco</dt>
          <dd className="tabular-nums text-fg">{totalMessages.toLocaleString("pt-BR")}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Carga do histórico</dt>
          <dd className="text-fg">
            {loadDone ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">concluída</span>
            ) : (
              <>
                em andamento{" "}
                <span className="tabular-nums text-fg-muted">
                  ({contactsWithCursor}/{totalContacts} contatos)
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>

      {lastRun?.status === "erro" && lastRun.error_message && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Último erro ({lastRun.error_kind ?? "geral"}): {lastRun.error_message}
        </p>
      )}
    </section>
  );
}
