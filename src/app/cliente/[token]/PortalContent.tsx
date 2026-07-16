"use client";

import { useState } from "react";
import type { PortalListing, PortalUpdate } from "@/lib/client-portal";
import PortalListings from "./PortalListings";
import PortalUpdates from "./PortalUpdates";

// Corpo do portal do cliente em duas abas: Listagens e Atualizações do
// projeto. Componente PRÓPRIO do portal (self-contained): recebe pronto o
// conteúdo curado que a página server buscou em client_portal_data — aqui
// não existe nenhuma consulta, só apresentação.

type Tab = "listagens" | "atualizacoes";

export default function PortalContent({
  listings,
  updates,
}: {
  listings: PortalListing[];
  updates: PortalUpdate[];
}) {
  const [tab, setTab] = useState<Tab>("listagens");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Seções do portal"
        className="mb-5 flex gap-1 border-b border-line"
      >
        <TabButton
          id="tab-listagens"
          active={tab === "listagens"}
          onClick={() => setTab("listagens")}
          label="Listagens"
          count={listings.length}
        />
        <TabButton
          id="tab-atualizacoes"
          active={tab === "atualizacoes"}
          onClick={() => setTab("atualizacoes")}
          label="Atualizações do projeto"
          count={updates.length}
        />
      </div>

      <div
        role="tabpanel"
        aria-labelledby={tab === "listagens" ? "tab-listagens" : "tab-atualizacoes"}
        className="animate-fade-in"
        key={tab}
      >
        {tab === "listagens" ? (
          <PortalListings listings={listings} />
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
