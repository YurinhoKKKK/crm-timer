"use client";

import { useState, type ReactNode } from "react";

type Tab = "overview" | "listings" | "notes" | "messages";

// Alterna entre "Visão geral" (a central completa do passo 19), "Minhas
// Listagens" (as entregas de listagem da empresa, passo 23), "Anotações"
// (rich text, passo 24) e "Mensagens" (conversa com o cliente, passo 31). Os
// conteúdos são renderizados no servidor e passados como slots; aqui só
// escolhemos a aba.
export default function CompanyCentralTabs({
  overview,
  listings,
  notes,
  messages,
  initialTab = "overview",
}: {
  overview: ReactNode;
  listings: ReactNode;
  notes: ReactNode;
  messages: ReactNode;
  // Deep-link (ex.: a caixa de entrada abre direto na aba Mensagens).
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

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
    { key: "messages", label: "Mensagens", content: messages },
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
