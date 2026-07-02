"use client";

import { useState, type ReactNode } from "react";

// Alterna entre "Tarefas" (instâncias/moldes por empresa) e "Tarefas Padrão"
// (o catálogo reutilizável). Ambos os conteúdos são renderizados no servidor e
// passados como slots; aqui só controlamos qual aba aparece.
export default function TarefasTabs({
  normal,
  standard,
}: {
  normal: ReactNode;
  standard: ReactNode;
}) {
  const [tab, setTab] = useState<"normal" | "standard">("normal");

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
          aria-selected={tab === "normal"}
          onClick={() => setTab("normal")}
          className={tabClass(tab === "normal")}
        >
          Tarefas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "standard"}
          onClick={() => setTab("standard")}
          className={tabClass(tab === "standard")}
        >
          Tarefas Padrão
        </button>
      </div>

      <div>{tab === "normal" ? normal : standard}</div>
    </>
  );
}
