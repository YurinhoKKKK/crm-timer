import Avatar from "@/components/Avatar";
import {
  MEETING_TYPE_LABEL,
  formatMeetingDay,
  formatMeetingRange,
  meetingDayKey,
  type GoogleSyncStatus,
  type MeetingRow,
} from "@/lib/meetings";

// Lista de reuniões agrupada por dia (próximas primeiro). Componente de
// apresentação puro — sem estado — reaproveitado na página /agenda e na aba
// "Reuniões" da central da empresa. `showCompany` some quando a lista já é de
// uma empresa só (a aba da central).
export default function MeetingList({
  rows,
  emptyLabel,
  showCompany = true,
}: {
  rows: MeetingRow[];
  emptyLabel: string;
  showCompany?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-fg-subtle shadow-card">
        {emptyLabel}
      </div>
    );
  }

  // Agrupa por dia (BRT), preservando a ordem ascendente já vinda do banco.
  const groups: { key: string; label: string; items: MeetingRow[] }[] = [];
  for (const row of rows) {
    const key = meetingDayKey(row.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(row);
    } else {
      groups.push({ key, label: formatMeetingDay(row.startsAt), items: [row] });
    }
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="mb-2 text-sm font-semibold text-fg-muted">
            {group.label}
          </h3>
          <ul className="space-y-2.5">
            {group.items.map((m) => (
              <li key={m.id}>
                <MeetingCard meeting={m} showCompany={showCompany} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MeetingCard({
  meeting: m,
  showCompany,
}: {
  meeting: MeetingRow;
  showCompany: boolean;
}) {
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
        )}
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
