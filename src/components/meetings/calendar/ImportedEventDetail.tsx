"use client";

import MeetingTimerControl from "@/components/meetings/MeetingTimerControl";
import {
  formatMeetingRange,
  type DirectoryUser,
  type ImportedEventRow,
  type ReachableCompany,
} from "@/lib/meetings";

const TZ = "America/Sao_Paulo";

function longDate(iso: string): string {
  const label = new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Detalhe SOMENTE-LEITURA de um evento importado do Google. Sem ações: nada aqui
// edita/exclui — o sistema não é dono deste evento. Para eventos particulares de
// outra pessoa, o título já chegou nulo do banco (mostra "Ocupado"); o dono vê o
// próprio título normalmente.
export default function ImportedEventDetail({
  event,
  ownerName,
  isOwn,
  currentUserId,
  companies,
  directory,
  nameById,
}: {
  event: ImportedEventRow;
  ownerName: string;
  isOwn: boolean;
  currentUserId: string;
  companies: ReachableCompany[];
  directory: DirectoryUser[];
  nameById: Map<string, string>;
}) {
  const title = event.title ?? "Ocupado";
  const whose = isOwn ? "Sua agenda do Google" : `Agenda de ${ownerName}`;

  // Só o dono da agenda inicia (decisão 3); evento particular não cronometra; e
  // se o evento é, na verdade, uma reunião do CRM, o timer é o da reunião (ajuste 2).
  const canStart = isOwn && !event.isPrivate && !event.isCrmMeeting;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{longDate(event.startsAt)}</p>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-fg-subtle">Horário</dt>
          <dd className="font-mono tabular-nums text-fg">
            {formatMeetingRange(event.startsAt, event.endsAt)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-fg-subtle">Origem</dt>
          <dd className="text-fg">{whose}</dd>
        </div>
      </dl>

      {!isOwn && event.isPrivate && (
        <p className="rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-xs text-fg-muted">
          Este compromisso está marcado como particular na agenda de {ownerName}.
          Você vê apenas que o horário está ocupado.
        </p>
      )}

      {/* Timer de reunião (0145). Para eventos importados, só o dono inicia e
          escolhe a empresa + consultores presentes. Reunião do CRM que chegou
          como evento importado cronometra pela reunião, não aqui. */}
      {event.isCrmMeeting ? (
        <p className="rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-xs text-fg-muted">
          Esta reunião foi criada pelo CRM — cronometre pelo card da reunião, não
          por este evento importado.
        </p>
      ) : event.isPrivate ? null : (
        <MeetingTimerControl
          kind="imported"
          googleEventId={event.googleEventId}
          scheduledStart={event.startsAt}
          currentUserId={currentUserId}
          canStart={canStart}
          companies={companies}
          directory={directory}
          nameById={nameById}
        />
      )}

      <p className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-xs text-fg-subtle">
        Vindo do Google Calendar · somente leitura. Este evento não é editado nem
        excluído por aqui — ele entra apenas para completar a agenda e avisar
        conflitos. Nunca aparece no portal do cliente.
      </p>
    </div>
  );
}
