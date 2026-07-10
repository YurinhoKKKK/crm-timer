"use client";

import { useState, type ReactNode } from "react";

// Alterna entre "Visão geral" (a central completa do passo 19) e "Minhas
// Listagens" (as entregas de listagem da empresa, passo 23). Ambos os conteúdos
// são renderizados no servidor e passados como slots; aqui só escolhemos a aba.
export default function CompanyCentralTabs({
  overview,
  listings,
}: {
  overview: ReactNode;
  listings: ReactNode;
}) {
  const [tab, setTab] = useState<"overview" | "listings">("overview");

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
      active
        ? "border-risd text-risd"
        : "border-transparent text-fg-muted hover:text-fg"
    }`;

  return (
    <>
      <div role="tablist" className="mb-6 flex gap-1 border-b border-line">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "overview"}
          onClick={() => setTab("overview")}
          className={tabClass(tab === "overview")}
        >
          Visão geral
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "listings"}
          onClick={() => setTab("listings")}
          className={tabClass(tab === "listings")}
        >
          Minhas Listagens
        </button>
      </div>

      <div>{tab === "overview" ? overview : listings}</div>
    </>
  );
}
