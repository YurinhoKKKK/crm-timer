"use client";

import { useMemo, useState, useTransition } from "react";
import {
  applyReconciliation,
  dismissReconciliation,
  finalizeReconciliation,
  type ReconcileRow,
  type ReconcileAction,
  type ReconcileOwner,
} from "@/app/meeting-reconcile-actions";

const TZ = "America/Sao_Paulo";

function fmt(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_LABEL: Record<ReconcileAction, string> = {
  update: "Atualizar",
  cancel_delete: "Cancelar (excluir do CRM)",
  cancel_keep: "Cancelar (manter no CRM)",
  revisar: "Só revisar",
};

const ACTION_TONE: Record<ReconcileAction, string> = {
  update:
    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  cancel_delete:
    "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  cancel_keep:
    "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  revisar:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

// Por que a linha está na fila (0174). null = divergência comum de horário/título.
const MOTIVO_LABEL: Record<string, string> = {
  cancelado_google: "cancelado no Google",
  nao_encontrada: "não encontrada no Google (404): nada foi apagado",
  conta_diferente: "o evento pertence a OUTRA conta Google",
  edicao_pendente: "há edição do CRM ainda não enviada ao Google",
  sem_horario: "virou evento de dia inteiro (sem horário)",
  horario_invalido: "horário inválido no Google",
  recorrente: "virou evento recorrente no Google",
  muitos_cancelamentos: "mais de 3 cancelamentos no mesmo sync (teto de segurança)",
  erro_interno: "erro ao enfileirar ou aplicar: revise manualmente",
};

// de → para de um campo, destacando quando muda.
function DeltaRow({
  label,
  from,
  to,
  changed,
}: {
  label: string;
  from: string;
  to: string;
  changed: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="w-14 shrink-0 text-fg-subtle">{label}</span>
      <span className={changed ? "text-fg-muted line-through" : "text-fg-muted"}>
        {from}
      </span>
      {changed && (
        <>
          <span className="text-fg-subtle">→</span>
          <span className="font-medium text-fg">{to}</span>
        </>
      )}
    </div>
  );
}

export default function ReconciliationPanel({
  initialRows,
  initialOwners,
}: {
  initialRows: ReconcileRow[];
  initialOwners: ReconcileOwner[];
}) {
  const [rows, setRows] = useState<ReconcileRow[]>(initialRows);
  const [owners, setOwners] = useState<ReconcileOwner[]>(initialOwners);
  const [error, setError] = useState<string | null>(null);
  // Confirmação de ação bem-sucedida (ex.: "Concluir") — slot separado do erro.
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Agrupa por dono (a prévia já vem ordenada por nome).
  const groups = useMemo(() => {
    const map = new Map<string, ReconcileRow[]>();
    for (const r of rows) {
      const list = map.get(r.ownerId) ?? [];
      list.push(r);
      map.set(r.ownerId, list);
    }
    return Array.from(map.entries()).map(([ownerId, list]) => ({
      ownerId,
      ownerName: list[0]?.ownerName ?? "(sem nome)",
      autoApplyFrom: list[0]?.ownerAutoApplyFrom ?? null,
      rows: list,
    }));
  }, [rows]);

  // Tira a linha resolvida da fila E atualiza a contagem de pendências do dono
  // no roster (o "Pronto para concluir" aparece sem recarregar).
  function removeRow(id: string) {
    setRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (row) {
        setOwners((os) =>
          os.map((o) =>
            o.userId === row.ownerId
              ? { ...o, pending: Math.max(0, o.pending - 1) }
              : o
          )
        );
      }
      return prev.filter((r) => r.id !== id);
    });
  }

  async function onApply(id: string) {
    setError(null);
    setBusyId(id);
    const res = await applyReconciliation(id);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? "Falha ao aplicar.");
      return;
    }
    startTransition(() => removeRow(id));
  }

  async function onDismiss(id: string) {
    setError(null);
    setBusyId(id);
    const res = await dismissReconciliation(id);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? "Falha ao dispensar.");
      return;
    }
    startTransition(() => removeRow(id));
  }

  async function onFinalize(ownerId: string, ownerName: string) {
    setError(null);
    setNotice(null);
    setBusyOwner(ownerId);
    const res = await finalizeReconciliation(ownerId);
    setBusyOwner(null);
    if (!res.ok) {
      // A trava do banco (pendências ou sync velho) chega aqui com a mensagem
      // completa e instrutiva.
      setError(res.error ?? "Falha ao concluir.");
      return;
    }
    // Reflete localmente que o dono virou "confiável" (auto-sync ligado).
    const nowISO = new Date().toISOString();
    setOwners((prev) =>
      prev.map((o) => (o.userId === ownerId ? { ...o, autoApplyFrom: nowISO } : o))
    );
    setRows((prev) =>
      prev.map((r) =>
        r.ownerId === ownerId ? { ...r, ownerAutoApplyFrom: nowISO } : r
      )
    );
    setNotice(`Auto-sync ligado para ${ownerName}. Dali pra frente as mudanças do Google entram sozinhas.`);
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-300/60 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Todos com Google conectado: é AQUI que se conclui a reconciliação —
          inclusive quem não tem (ou nunca teve) divergência pendente. */}
      <section className="rounded-xl border border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-fg">
            Usuários com Google conectado
            <span className="ml-2 font-normal text-fg-subtle">{owners.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Concluir liga o auto-sync Google para o CRM da pessoa. Exige fila sem
            pendências e sincronização nos últimos 30 minutos.
          </p>
        </header>
        {owners.length === 0 ? (
          <p className="px-4 py-4 text-sm text-fg-muted">
            Ninguém conectou o Google ainda.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {owners.map((o) => {
              const name = o.name ?? "(sem nome)";
              const ligado = !!o.autoApplyFrom;
              const comPendencias = !ligado && o.pending > 0;
              return (
                <li
                  key={o.userId}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-fg">{name}</span>
                    {o.googleEmail && (
                      <span className="ml-2 text-xs text-fg-subtle">{o.googleEmail}</span>
                    )}
                    <span className="ml-2 text-xs text-fg-subtle">
                      Último sync: {o.lastSyncedAt ? fmt(o.lastSyncedAt) : "nunca"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {ligado ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300">
                        Auto-sync ligado desde {fmt(o.autoApplyFrom)}
                      </span>
                    ) : comPendencias ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        Com pendências ({o.pending})
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                        Pronto para concluir
                      </span>
                    )}
                    {!ligado && (
                      <button
                        type="button"
                        onClick={() => onFinalize(o.userId, name)}
                        disabled={busyOwner === o.userId || comPendencias}
                        title={
                          comPendencias
                            ? `Aplique ou dispense as ${o.pending} divergências pendentes de ${name} antes de concluir.`
                            : "Liga o auto-sync Google para o CRM deste usuário."
                        }
                        className="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyOwner === o.userId ? "Concluindo…" : "Concluir (ligar auto-sync)"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {rows.length === 0 && (
        <div className="rounded-xl border border-line bg-surface-2 p-8 text-center text-sm text-fg-muted">
          Nenhuma divergência. O sistema resolve as mudanças do Google sozinho; só
          aparecem aqui os casos que precisam de decisão.
        </div>
      )}

      {groups.map((g) => (
        <section key={g.ownerId} className="rounded-xl border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-fg">
              {g.ownerName}
              <span className="ml-2 font-normal text-fg-subtle">
                {g.rows.length} {g.rows.length === 1 ? "divergência" : "divergências"}
              </span>
            </h3>
          </header>

          <ul className="divide-y divide-line">
            {g.rows.map((r) => {
              const isReview = r.action === "revisar";
              const isCancel = r.action === "cancel_delete" || r.action === "cancel_keep";
              return (
                <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_TONE[r.action]}`}
                      >
                        {ACTION_LABEL[r.action]}
                      </span>
                      {r.motivo && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                          {MOTIVO_LABEL[r.motivo] ?? r.motivo}
                        </span>
                      )}
                      {r.companyName && (
                        <span className="truncate text-xs text-fg-subtle">
                          {r.companyName}
                        </span>
                      )}
                    </div>

                    {isReview ? (
                      <div className="text-sm text-fg-muted">
                        “{r.crmTitle ?? "(sem título)"}” · {fmt(r.crmStartsAt)}. Nada é
                        aplicado automaticamente; resolva a causa e dispense a linha.
                      </div>
                    ) : isCancel ? (
                      <div className="text-sm text-fg-muted">
                        “{r.crmTitle ?? "(sem título)"}” · {fmt(r.crmStartsAt)}
                        {r.motivo === "nao_encontrada"
                          ? ": o evento não foi encontrado no Google (pode ter sido apagado ou movido de conta)."
                          : ": removida no Google."}
                        {r.action === "cancel_keep"
                          ? " Ao aplicar, MANTÉM no CRM com o selo “removida no Google” (tem horas ou já passou)."
                          : " Ao aplicar, será excluída do CRM (futura, sem horas)."}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        <DeltaRow
                          label="Título"
                          from={r.crmTitle ?? "(sem título)"}
                          to={r.googleTitle ?? "(sem título)"}
                          changed={(r.crmTitle ?? "") !== (r.googleTitle ?? "")}
                        />
                        <DeltaRow
                          label="Início"
                          from={fmt(r.crmStartsAt)}
                          to={fmt(r.googleStartsAt)}
                          changed={r.crmStartsAt !== r.googleStartsAt}
                        />
                        <DeltaRow
                          label="Fim"
                          from={fmt(r.crmEndsAt)}
                          to={fmt(r.googleEndsAt)}
                          changed={r.crmEndsAt !== r.googleEndsAt}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!isReview && (
                      <button
                        type="button"
                        onClick={() => onApply(r.id)}
                        disabled={busyId === r.id}
                        className="rounded-full bg-fg px-3 py-1 text-xs font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === r.id ? "Aplicando…" : "Aplicar"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDismiss(r.id)}
                      disabled={busyId === r.id}
                      className="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-2 disabled:opacity-50"
                    >
                      Dispensar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
