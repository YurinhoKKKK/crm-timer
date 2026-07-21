"use client";

import { useState } from "react";
import type {
  PortalListing,
  PortalProgress,
  PortalSource,
  PortalUpdate,
} from "@/lib/client-portal";
import PortalListings from "./PortalListings";
import PortalUpdates from "./PortalUpdates";
import PortalProgressFeed from "./PortalProgressFeed";

// Corpo do portal do cliente em abas: Listagens, Andamento (só aparece se o
// feed curado tiver ao menos 1 item) e Atualizações do projeto. Componente
// PRÓPRIO do portal (self-contained): recebe pronto o conteúdo curado que a
// página server buscou (client_portal_data / client_portal_progress) — aqui
// não existe nenhuma consulta, só apresentação.

type Tab = "listagens" | "andamento" | "atualizacoes";

export default function PortalContent({
  source,
  listings,
  progress,
  updates,
}: {
  source: PortalSource;
  listings: PortalListing[];
  progress: PortalProgress;
  updates: PortalUpdate[];
}) {
  const [tab, setTab] = useState<Tab>("listagens");
  const showProgress = progress.total > 0;

  // Se a aba ativa deixou de existir (feed esvaziou entre renders), volta
  // para Listagens.
  const active: Tab = tab === "andamento" && !showProgress ? "listagens" : tab;

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
        <TabButton
          id="tab-atualizacoes"
          active={active === "atualizacoes"}
          onClick={() => setTab("atualizacoes")}
          label="Atualizações do projeto"
          count={updates.length}
        />
      </div>

      <div
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        className="animate-fade-in"
        key={active}
      >
        {active === "listagens" ? (
          <PortalListings listings={listings} />
        ) : active === "andamento" ? (
          <PortalProgressFeed source={source} initial={progress} />
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
