"use client";

import { useState } from "react";
import { ShowMore } from "@/components/ListControls";
import CopyLinkButton from "@/components/CopyLinkButton";
import {
  PORTAL_MEETING_TYPE_LABEL,
  type PortalMeeting,
  type PortalMeetings,
  type PortalSource,
} from "@/lib/client-portal";
import { formatPortalLongDate, formatPortalRange } from "./portal-format";
import { clientPortalMeetingsPage } from "../actions";
import { clientPreviewMeetingsPage } from "@/app/client-preview-actions";

// Aba "Reuniões" do portal do cliente. Render PRÓPRIO e enxuto (self-contained):
// não reutiliza nenhum componente interno de reunião — estes carregam campos
// internos (participantes, descrição, criador, sincronização). Aqui só chega o
// conteúdo JÁ CURADO pelo banco (client_portal_meetings): título, horário, tipo
// em linguagem do cliente e, SÓ nas próximas online, o link do Meet.
//
// Duas seções: PRÓXIMAS (mais perto primeiro) e ANTERIORES (mais recente
// primeiro, paginadas — o histórico cresce). O "ver mais" pede a próxima página
// das anteriores ao servidor (sessão do cliente ou preview interno; o conteúdo
// é o mesmo, cai na mesma curadoria).
export default function PortalMeetingsTab({
  source,
  initial,
}: {
  source: PortalSource;
  initial: PortalMeetings;
}) {
  const upcoming = initial.upcoming;
  const [past, setPast] = useState<PortalMeeting[]>(initial.past.items);
  const [pastTotal, setPastTotal] = useState(initial.past.total);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, pastTotal - past.length);

  async function showMore() {
    if (loading) return;
    setLoading(true);
    setError(null);
    const page =
      source.mode === "portal"
        ? await clientPortalMeetingsPage(source.token, past.length)
        : await clientPreviewMeetingsPage(source.companyId, past.length);
    if (!page) {
      setError(
        "Não foi possível carregar mais reuniões. Recarregue a página e tente de novo."
      );
    } else {
      setPast((prev) => [...prev, ...page.items]);
      setPastTotal(page.total);
    }
    setLoading(false);
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-tint text-risd">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Reuniões
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            As próximas reuniões agendadas e o histórico das já realizadas.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-7">
        {upcoming.length > 0 && (
          <Group title="Próximas">
            {upcoming.map((m, i) => (
              <MeetingRow key={`u-${i}`} m={m} upcoming />
            ))}
          </Group>
        )}

        {past.length > 0 && (
          <Group title="Anteriores">
            {past.map((m, i) => (
              <MeetingRow key={`p-${i}`} m={m} upcoming={false} />
            ))}
          </Group>
        )}
      </div>

      {remaining > 0 && !loading && (
        <ShowMore remaining={remaining} onClick={showMore} />
      )}
      {loading && (
        <p className="mt-4 text-center text-sm text-fg-subtle">Carregando…</p>
      )}
      {error && (
        <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </p>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  );
}

function MeetingRow({
  m,
  upcoming,
}: {
  m: PortalMeeting;
  upcoming: boolean;
}) {
  // Link do Meet só existe (o banco só o envia) nas PRÓXIMAS online.
  const showMeet = upcoming && m.type === "meet" && !!m.meet_link;

  return (
    <li className="rounded-xl border border-line bg-surface-2/40 p-4">
      <p className="text-xs font-medium text-fg-subtle">
        {formatPortalLongDate(m.starts_at)}
      </p>
      <p className="mt-0.5 font-semibold text-fg">{m.title}</p>
      <p className="mt-1 text-sm text-fg-muted">
        <span className="font-mono tabular-nums">
          {formatPortalRange(m.starts_at, m.ends_at)}
        </span>
        <span className="mx-2 text-fg-subtle" aria-hidden="true">
          ·
        </span>
        {PORTAL_MEETING_TYPE_LABEL[m.type]}
      </p>

      {showMeet && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={m.meet_link!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-risd px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
          <CopyLinkButton value={m.meet_link!} />
        </div>
      )}
    </li>
  );
}
