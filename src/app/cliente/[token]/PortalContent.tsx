"use client";

import { useState } from "react";
import type {
  PortalListing,
  PortalMeetings,
  PortalMessages,
  PortalProgress,
  PortalSource,
  PortalUpdate,
} from "@/lib/client-portal";
import PortalListings from "./PortalListings";
import PortalUpdates from "./PortalUpdates";
import PortalProgressFeed from "./PortalProgressFeed";
import PortalMessagesTab from "./PortalMessages";
import PortalMeetingsTab from "./PortalMeetings";

// Corpo do portal do cliente em abas: Listagens, Andamento (só aparece se o
// feed curado tiver ao menos 1 item) e Atualizações do projeto. Componente
// PRÓPRIO do portal (self-contained): recebe pronto o conteúdo curado que a
// página server buscou (client_portal_data / client_portal_progress) — aqui
// não existe nenhuma consulta, só apresentação.

type Tab =
  | "listagens"
  | "andamento"
  | "reunioes"
  | "atualizacoes"
  | "mensagens";

export default function PortalContent({
  source,
  listings,
  progress,
  updates,
  messages,
  meetings,
}: {
  source: PortalSource;
  listings: PortalListing[];
  progress: PortalProgress;
  updates: PortalUpdate[];
  messages: PortalMessages;
  meetings: PortalMeetings;
}) {
  const [tab, setTab] = useState<Tab>("listagens");
  const showProgress = progress.total > 0;
  // A aba de reuniões só existe se houver ao menos uma reunião VISÍVEL (próxima
  // ou anterior não oculta).
  const meetingsCount = meetings.upcoming.length + meetings.past.total;
  const showMeetings = meetingsCount > 0;

  // Se a aba ativa deixou de existir (feed esvaziou entre renders), volta
  // para Listagens.
  const active: Tab =
    (tab === "andamento" && !showProgress) ||
    (tab === "reunioes" && !showMeetings)
      ? "listagens"
      : tab;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Seções do portal"
        className="mb-5 flex flex-wrap gap-1 border-b border-line"
      >
        <TabButton
          id="tab-listagens"
          active={active === "listagens"}
          onClick={() => setTab("listagens")}
          label="Listagens"
          count={listings.length}
        />
        {showProgress && (
          <TabButton
            id="tab-andamento"
            active={active === "andamento"}
            onClick={() => setTab("andamento")}
            label="Andamento"
            count={progress.total}
          />
        )}
        {showMeetings && (
          <TabButton
            id="tab-reunioes"
            active={active === "reunioes"}
            onClick={() => setTab("reunioes")}
            label="Reuniões"
            count={meetingsCount}
          />
        )}
        <TabButton
          id="tab-atualizacoes"
          active={active === "atualizacoes"}
          onClick={() => setTab("atualizacoes")}
          label="Atualizações do projeto"
          count={updates.length}
        />
        {/* Diferente de Andamento, esta aba aparece SEMPRE, mesmo vazia: se ela
            só surgisse depois da primeira mensagem, o cliente nunca
            descobriria que pode falar com a equipe. */}
        <TabButton
          id="tab-mensagens"
          active={active === "mensagens"}
          onClick={() => setTab("mensagens")}
          label="Mensagens"
          count={messages.total}
        />
      </div>

      <div
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        className="animate-fade-in"
        key={active}
      >
        {active === "listagens" ? (
          <PortalListings listings={listings} source={source} />
        ) : active === "andamento" ? (
          <PortalProgressFeed source={source} initial={progress} />
        ) : active === "reunioes" ? (
          <PortalMeetingsTab source={source} initial={meetings} />
        ) : active === "mensagens" ? (
          <PortalMessagesTab source={source} initial={messages} />
        ) : (
          <PortalUpdates updates={updates} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  id,
  active,
  onClick,
  label,
  count,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd sm:px-4 ${
        active
          ? "border-risd font-semibold text-fg"
          : "border-transparent font-medium text-fg-muted hover:text-fg"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
          active
            ? "bg-brand-tint text-risd dark:text-white"
            : "bg-surface-2 text-fg-subtle"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
