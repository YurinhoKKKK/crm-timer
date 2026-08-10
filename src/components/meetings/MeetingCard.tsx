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
  refreshMeetingResponses,
  respondToMeeting,
} from "@/app/meeting-actions";
import {
  MEETING_TYPE_LABEL,
  MEETING_ROOM_LABEL,
  MEETING_RESPONSE_LABEL,
  formatMeetingRange,
  type GoogleSyncStatus,
  type MeetingActionsContext,
  type MeetingResponse,
  type MeetingRow,
} from "@/lib/meetings";

// Botões compactos do rodapé do cartão (independentes de btnPrimary/Secondary,
// que são grandes demais para uma barra de ações).
const actBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted transition hover:border-risd/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
const actDanger =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-300/60 bg-surface px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10";

// Status recém-lidos do Google que sobem para o pai espelhar no seu cache (só o
// calendário usa — ver Calendar.applyResponses). `byUser` = resposta por
// participante; `room`/`syncedAt` só vêm no "Atualizar status" (no RSVP mudam só
// a própria linha). A action JÁ gravou no banco; isto evita que fechar+reabrir o
// modal (sem recarregar) mostre o valor velho do cache.
export type ResponsesPatch = {
  byUser: Map<string, MeetingResponse | null>;
  room?: MeetingResponse | null;
  syncedAt?: string;
};

// As três respostas que o participante pode dar (needsAction não é escolha).
const RSVP_OPTIONS: { value: MeetingResponse; label: string }[] = [
  { value: "accepted", label: "Aceitar" },
  { value: "tentative", label: "Talvez" },
  { value: "declined", label: "Recusar" },
];

// Um cartão de reunião com as AÇÕES por permissão. Só o criador edita/exclui e
// envia ao Google; para os demais o botão fica desabilitado e EXPLICADO; o admin
// tem "Remover do sistema" (não toca no Google) para reuniões que não são dele.
export default function MeetingCard({
  meeting: m,
  showCompany,
  ctx,
  onResult,
  onResponses,
}: {
  meeting: MeetingRow;
  showCompany: boolean;
  ctx: MeetingActionsContext;
  // Sobe o resultado de uma ação (warning âmbar; senão o texto verde de sucesso)
  // para a lista mostrar o banner ACIMA — o cartão pode sumir no refresh.
  onResult: (warning: string | null, successText: string) => void;
  // Sobe os status recém-lidos/enviados para o pai espelhar no cache SEM fechar o
  // modal (só o calendário passa; a lista, que já dá router.refresh, omite).
  onResponses?: (meetingId: string, patch: ResponsesPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "adminRemove">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Espelho VIVO do status dos convites depois de "Atualizar status" (Fatia B/C).
  // O refresh não sobe via onResult (fecharia o painel do calendário); guardamos
  // localmente para o quadro refletir na hora. A action já gravou no banco, então
  // um reload futuro traz os mesmos valores. null = ainda usando o que veio do props.
  const [live, setLive] = useState<null | {
    byUser: Map<string, MeetingResponse | null>;
    room: MeetingResponse | null;
    syncedAt: string;
  }>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // RSVP do próprio participante (Fatia D). `myResp` = override otimista da
  // própria resposta; undefined = sem override (usa o que veio do props/live).
  const [myResp, setMyResp] = useState<MeetingResponse | null | undefined>(
    undefined
  );
  const [responding, setResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const isCreator = m.creator.id === ctx.currentUserId;
  const isParticipant = m.participants.some((p) => p.id === ctx.currentUserId);

  // Status a exibir: a própria resposta recém-enviada (myResp) vence para o
  // usuário atual; senão o vivo (após "Atualizar status"); senão o do props.
  const responseFor = (userId: string): MeetingResponse | null => {
    if (userId === ctx.currentUserId && myResp !== undefined) return myResp;
    if (live) return live.byUser.get(userId) ?? null;
    return m.participants.find((p) => p.id === userId)?.response ?? null;
  };
  const roomResponse = live ? live.room : m.roomResponse;
  const responsesSyncedAt = live ? live.syncedAt : m.responsesSyncedAt;

  // O quadro de status só faz sentido quando a reunião está no Google e há a quem
  // responder (participantes ou sala). Só o criador consegue LER (tem o token).
  const hasAttendees = m.participants.length > 0 || !!m.room;
  const showStatusPanel = m.syncStatus === "sincronizado" && hasAttendees;
  const canRefreshStatus = showStatusPanel && isCreator && ctx.googleConnected;

  // Resumo por status (também serve de legenda das bolinhas). Ignora null (não
  // lido). Ordem fixa: confirmou, recusou, talvez, sem resposta.
  const tally: Record<MeetingResponse, number> = {
    accepted: 0,
    declined: 0,
    tentative: 0,
    needsAction: 0,
  };
  for (const p of m.participants) {
    const r = responseFor(p.id);
    if (r) tally[r] += 1;
  }
  if (m.room && roomResponse) tally[roomResponse] += 1;
  const summaryEntries = (
    ["accepted", "declined", "tentative", "needsAction"] as MeetingResponse[]
  )
    .filter((r) => tally[r] > 0)
    .map((r) => [r, tally[r]] as const);
  const anyRead = summaryEntries.length > 0;

  async function onRefreshStatus() {
    setRefreshing(true);
    setStatusError(null);
    try {
      const res = await refreshMeetingResponses(m.id);
      if (!res.ok) {
        setStatusError(res.error);
        return;
      }
      const byUser = new Map(res.participants.map((p) => [p.userId, p.response]));
      setLive({ byUser, room: res.room, syncedAt: res.syncedAt });
      // O refresh leu o Google de novo — a fonte da verdade. Zera o override
      // otimista para o valor lido valer.
      setMyResp(undefined);
      // Espelha no cache do pai para o valor sobreviver ao fechar/reabrir o modal
      // (o banco já foi gravado pela action; isto só sincroniza o cliente).
      onResponses?.(m.id, { byUser, room: res.room, syncedAt: res.syncedAt });
    } finally {
      setRefreshing(false);
    }
  }

  async function onRespond(value: MeetingResponse) {
    setResponding(true);
    setRespondError(null);
    try {
      const res = await respondToMeeting(m.id, value);
      if (!res.ok) {
        setRespondError(res.error);
        return;
      }
      setMyResp(res.response);
      // Mesma ideia do refresh: espelha a própria resposta no cache do pai para
      // não sumir ao reabrir o modal (a action já gravou pelo set_my_meeting_response).
      onResponses?.(m.id, {
        byUser: new Map([[ctx.currentUserId, res.response]]),
      });
    } finally {
      setResponding(false);
    }
  }

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
      room: m.room,
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
          {m.room && <RoomBadge room={m.room} response={roomResponse} />}
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
                {m.participants.map((p) => {
                  const resp = responseFor(p.id);
                  return (
                    <span
                      key={p.id}
                      title={resp ? MEETING_RESPONSE_LABEL[resp] : undefined}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs text-fg-muted"
                    >
                      <Avatar name={p.name} url={p.avatarUrl} size={18} />
                      {p.name}
                      <StatusDot response={resp} />
                    </span>
                  );
                })}
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

      {/* Quadro de status dos convites (Fatia B/C). Google é a verdade; aqui é o
          espelho lido por quem criou. As bolinhas nos participantes acima dão o
          detalhe por pessoa; esta linha resume e traz o "atualizar". */}
      {showStatusPanel && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              {anyRead ? (
                summaryEntries.map(([r, count]) => (
                  <span key={r} className="inline-flex items-center gap-1">
                    <StatusDot response={r} />
                    {MEETING_RESPONSE_LABEL[r]}:{" "}
                    <span className="font-medium text-fg">{count}</span>
                  </span>
                ))
              ) : (
                <span className="text-fg-subtle">
                  Status dos convites ainda não lido do Google.
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {responsesSyncedAt && (
                <span className="text-xs text-fg-subtle">
                  lido {formatSyncedAgo(responsesSyncedAt)}
                </span>
              )}
              {canRefreshStatus ? (
                <button
                  type="button"
                  onClick={onRefreshStatus}
                  disabled={refreshing}
                  className="rounded text-xs font-medium text-risd transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {refreshing ? "Lendo…" : "Atualizar status"}
                </button>
              ) : isCreator ? (
                <span className="text-xs text-fg-subtle">
                  Conecte o Google no seu perfil para ler o status.
                </span>
              ) : (
                <span
                  className="text-xs text-fg-subtle"
                  title="Só quem criou tem o acesso à agenda onde o evento vive."
                >
                  Só {m.creator.name} atualiza o status.
                </span>
              )}
            </div>
          </div>
          {statusError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {statusError}
            </p>
          )}

          {/* RSVP do próprio participante (Fatia D). O criador é organizador, não
              responde. Sem Google conectado, cai no convite original. */}
          {isParticipant &&
            (ctx.googleConnected ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-line pt-1.5">
                <span className="text-xs text-fg-subtle">Sua resposta:</span>
                {RSVP_OPTIONS.map((opt) => {
                  const active = responseFor(ctx.currentUserId) === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onRespond(opt.value)}
                      disabled={responding}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "border-risd/50 bg-brand-tint text-risd"
                          : "border-line bg-surface text-fg-muted hover:border-risd/40 hover:text-fg"
                      }`}
                    >
                      <StatusDot response={opt.value} />
                      {opt.label}
                    </button>
                  );
                })}
                {responding && (
                  <span className="text-xs text-fg-subtle">enviando…</span>
                )}
              </div>
            ) : (
              <p className="mt-1.5 border-t border-line pt-1.5 text-xs text-fg-subtle">
                Conecte sua conta Google no seu perfil para aceitar ou recusar
                aqui — ou responda pelo convite no Google Agenda.
              </p>
            ))}
          {respondError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {respondError}
            </p>
          )}
        </div>
      )}

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

// Sala reservada (Fatia A). Só aparece em presencial no escritório com sala
// escolhida — um selo discreto, com ícone de porta/lugar. A bolinha (Fatia B/C)
// mostra se a sala aceitou o convite (reserva confirmada), recusou (ocupada) etc.
function RoomBadge({
  room,
  response,
}: {
  room: NonNullable<MeetingRow["room"]>;
  response: MeetingResponse | null;
}) {
  return (
    <span
      title={response ? `Sala — ${MEETING_RESPONSE_LABEL[response]}` : undefined}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-muted"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 21h18" />
        <path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
        <path d="M16 8h3a2 2 0 0 1 2 2v11" />
        <path d="M11 12h.01" />
      </svg>
      {MEETING_ROOM_LABEL[room]}
      <StatusDot response={response} />
    </span>
  );
}

// Bolinha colorida do status de resposta. null (não lido / fora do evento) não
// desenha nada — assim "ainda não lido" difere de "lido e sem resposta" (cinza).
const STATUS_TONE: Record<MeetingResponse, string> = {
  accepted: "bg-emerald-500",
  declined: "bg-red-500",
  tentative: "bg-amber-500",
  needsAction: "bg-slate-400 dark:bg-slate-500",
};

function StatusDot({ response }: { response: MeetingResponse | null }) {
  if (!response) return null;
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_TONE[response]}`}
      aria-hidden="true"
    />
  );
}

// "agora" / "há 3 min" / "há 2 h" / "há 3 d" — frescor do espelho de status.
function formatSyncedAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "agora";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
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
