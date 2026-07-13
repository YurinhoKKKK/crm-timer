"use client";

import { useState, type ReactNode } from "react";

type Tab = "overview" | "listings" | "notes";

// Alterna entre "Visão geral" (a central completa do passo 19), "Minhas
// Listagens" (as entregas de listagem da empresa, passo 23) e "Anotações"
// (rich text, passo 24). Os conteúdos são renderizados no servidor e passados
// como slots; aqui só escolhemos a aba.
export default function CompanyCentralTabs({
  overview,
  listings,
  notes,
}: {
  overview: ReactNode;
  listings: ReactNode;
  notes: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
      active
        ? "border-risd text-risd"
        : "border-transparent text-fg-muted hover:text-fg"
    }`;

  const tabs: { key: Tab; label: string; content: ReactNode }[] = [
    { key: "overview", label: "Visão geral", content: overview },
    { key: "listings", label: "Minhas Listagens", content: listings },
    { key: "notes", label: "Anotações", content: notes },
  ];

  return (
    <>
      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={tabClass(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>{tabs.find((t) => t.key === tab)?.content}</div>
    </>
  );
}
