"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import CopyLinkButton from "@/components/CopyLinkButton";
import MeetingForm, { type MeetingInitial } from "./MeetingForm";
import {
  deleteMeeting,
  adminRemoveMeeting,
  syncMeetingToGoogle,
  setMeetingClientHidden,
} from "@/app/meeting-actions";
import {
  MEETING_TYPE_LABEL,
  formatMeetingRange,
  type GoogleSyncStatus,
  type MeetingActionsContext,
  type MeetingRow,
} from "@/lib/meetings";

// Botões compactos do rodapé do cartão (independentes de btnPrimary/Secondary,
// que são grandes demais para uma barra de ações).
const actBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:border-risd/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
const actDanger =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-300/60 bg-surface px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10";

// Um cartão de reunião com as AÇÕES por permissão. Só o criador edita/exclui e
// envia ao Google; para os demais o botão fica desabilitado e EXPLICADO; o admin
// tem "Remover do sistema" (não toca no Google) para reuniões que não são dele.
export default function MeetingCard({
  meeting: m,
  showCompany,
  ctx,
  onResult,
}: {
  meeting: MeetingRow;
  showCompany: boolean;
  ctx: MeetingActionsContext;
  // Sobe o resultado de uma ação (warning âmbar; senão o texto verde de sucesso)
  // para a lista mostrar o banner ACIMA — o cartão pode sumir no refresh.
  onResult: (warning: string | null, successText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "adminRemove">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreator = m.creator.id === ctx.currentUserId;
  const canSyncLater =
    isCreator &&
    ctx.googleConnected &&
    (m.syncStatus === "nao_conectado" || m.syncStatus === "falhou");
  const adminOrphan = ctx.isAdmin && !isCreator;

  // Quem pode ocultar/mostrar ao cliente: criador, admin, ou consultor da
  // empresa. Na central o acesso já implica gestão (lockedCompany). O banco é
  // quem autoriza de fato (set_meeting_client_hidden); aqui só decidimos exibir.
  const canToggleClient =
    isCreator ||
    ctx.isAdmin ||
    !!ctx.lockedCompany ||
    (ctx.managedCompanyIds?.includes(m.companyId) ?? false);

  async function onToggleClientHidden() {
    await run(async () => {
      const res = await setMeetingClientHidden(m.id, !m.clientHidden);
      if (!res.ok) return setError(res.error ?? "Não foi possível alterar.");
      onResult(
        null,
        m.clientHidden
          ? "Reunião agora aparece no portal do cliente."
          : "Reunião ocultada do portal do cliente."
      );
    });
  }

  async function run(
    fn: () => Promise<void>,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    await run(async () => {
      const res = await deleteMeeting(m.id);
      if (!res.ok) return setError(res.error);
      setConfirm(null);
      onResult(res.warning, "Reunião excluída.");
    });
  }

  async function onAdminRemove() {
    await run(async () => {
      const res = await adminRemoveMeeting(m.id);
      if (!res.ok) return setError(res.error ?? "Não foi possível remover.");
      setConfirm(null);
      onResult(
        "Reunião removida do sistema. O evento no Google (se havia) NÃO foi alterado — ele pode continuar na agenda de quem criou.",
        ""
      );
    });
  }

  async function onSync() {
    await run(async () => {
      const res = await syncMeetingToGoogle(m.id);
      if (!res.ok) return setError(res.error);
      onResult(res.warning, "Reunião enviada à sua agenda Google.");
    });
  }

  if (editing) {
    const initial: MeetingInitial = {
      companyId: m.companyId,
      companyName: m.companyName,
      title: m.title,
      description: m.description ?? "",
      type: m.type,
      startISO: m.startsAt,
      endISO: m.endsAt,
      participantIds: m.participants.map((p) => p.id),
    };
    return (
      <MeetingForm
        mode="edit"
        meetingId={m.id}
        initial={initial}
        directory={ctx.directory}
        companies={ctx.companies}
        lockedCompany={ctx.lockedCompany}
        onDone={(warning) => {
          setEditing(false);
          onResult(warning, "Alterações salvas.");
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold tabular-nums text-fg">
            {formatMeetingRange(m.startsAt, m.endsAt)}
          </p>
          <p className="mt-0.5 font-medium text-fg">{m.title}</p>
          {showCompany && (
            <p className="mt-0.5 text-xs text-fg-subtle">{m.companyName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeBadge type={m.type} />
          <SyncBadge status={m.syncStatus} error={m.syncError} />
        </div>
      </div>

      {m.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">
          {m.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* Criador + participantes */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <Avatar name={m.creator.name} url={m.creator.avatarUrl} size={20} />
            <span className="text-fg-subtle">Criada por</span>
            <span className="font-medium text-fg">{m.creator.name}</span>
          </span>
          {m.participants.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-xs text-fg-subtle">Participantes:</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {m.participants.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs text-fg-muted"
                  >
                    <Avatar name={p.name} url={p.avatarUrl} size={18} />
                    {p.name}
                  </span>
                ))}
              </span>
            </span>
          )}
        </div>

        {m.type === "meet" && m.meetLink && (
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={m.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-risd px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
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
              >
                <path d="m23 7-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              Entrar no Meet
            </a>
            <CopyLinkButton value={m.meetLink} />
          </div>
        )}
      </div>

      {/* Visibilidade ao cliente (discreto): a equipe vê que o TÍTULO desta
          reunião é lido pelo cliente no portal, e alterna. */}
      {canToggleClient && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              m.clientHidden ? "text-fg-subtle" : "text-fg-muted"
            }`}
          >
            {m.clientHidden ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
            {m.clientHidden
              ? "Oculta do portal do cliente"
              : "Aparece no portal do cliente"}
          </span>
          <button
            type="button"
            onClick={onToggleClientHidden}
            disabled={busy}
            className="rounded text-xs font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Salvando…"
              : m.clientHidden
              ? "Mostrar ao cliente"
              : "Ocultar do cliente"}
          </button>
        </div>
      )}

      {/* -------- Barra de ações -------- */}
      <div className="mt-3 border-t border-line pt-3">
        {confirm === "delete" ? (
          <ConfirmRow
            question="Excluir esta reunião? Os convidados serão avisados e o evento será removido da sua agenda Google."
            confirmLabel="Sim, excluir"
            busy={busy}
            danger
            onConfirm={onDelete}
            onCancel={() => setConfirm(null)}
          />
        ) : confirm === "adminRemove" ? (
          <ConfirmRow
            question="Remover esta reunião do sistema? Isso NÃO altera o Google — o evento pode permanecer na agenda de quem criou. Use apenas para reuniões órfãs."
            confirmLabel="Remover do sistema"
            busy={busy}
            danger
            onConfirm={onAdminRemove}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {isCreator ? (
              <>
                <button
                  type="button"
                  className={actBtn}
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className={actDanger}
                  disabled={busy}
                  onClick={() => setConfirm("delete")}
                >
                  Excluir
                </button>
                {canSyncLater && (
                  <button
                    type="button"
                    className={actBtn}
                    disabled={busy}
                    onClick={onSync}
                  >
                    {busy ? "Enviando…" : "Enviar para o Google Calendar"}
                  </button>
                )}
              </>
            ) : (
              <span
                className="text-xs text-fg-subtle"
                title="O evento pertence à agenda Google de quem criou; só essa pessoa pode editar ou excluir com sincronia."
              >
                Só quem criou (<span className="text-fg-muted">{m.creator.name}</span>)
                pode editar ou excluir esta reunião.
              </span>
            )}

            {adminOrphan && (
              <button
                type="button"
                className={actDanger}
                disabled={busy}
                onClick={() => setConfirm("adminRemove")}
                title="Remove só do sistema; não toca no Google. Para reuniões órfãs (quem criou saiu)."
              >
                Remover do sistema
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}

function ConfirmRow({
  question,
  confirmLabel,
  busy,
  danger,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-fg-muted">{question}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className={danger ? actDanger : actBtn}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Processando…" : confirmLabel}
        </button>
        <button
          type="button"
          className={actBtn}
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: MeetingRow["type"] }) {
  const isMeet = type === "meet";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        isMeet
          ? "bg-brand-tint text-risd"
          : "border border-line bg-surface-2 text-fg-muted"
      }`}
    >
      {MEETING_TYPE_LABEL[type]}
    </span>
  );
}

// Estado da sincronização com o Google. É informativo — a reunião existe no
// sistema de qualquer forma. Só chama atenção (âmbar/vermelho) quando ficou fora
// da agenda; sincronizada aparece discreta.
function SyncBadge({
  status,
  error,
}: {
  status: GoogleSyncStatus;
  error: string | null;
}) {
  if (status === "sincronizado") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        Na agenda Google
      </span>
    );
  }
  if (status === "nao_conectado") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        Fora da agenda Google
      </span>
    );
  }
  if (status === "falhou") {
    return (
      <span
        title={error ?? undefined}
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300"
      >
        Falha na sincronização
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-subtle">
      Sincronizando…
    </span>
  );
}
