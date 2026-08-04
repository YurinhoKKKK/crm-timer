"use client";

import { btnPrimary } from "@/lib/ui";

export type CalendarView = "day" | "week" | "month";

const VIEW_LABEL: Record<CalendarView, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

// Barra superior do calendário: Criar, Hoje, setas, período por extenso e o
// seletor de visão (Dia/Semana/Mês). Espírito do Google Calendar.
export default function CalendarToolbar({
  view,
  label,
  onView,
  onToday,
  onPrev,
  onNext,
  onCreate,
  onToggleSidebar,
  sidebarCollapsed,
}: {
  view: CalendarView;
  label: string;
  onView: (v: CalendarView) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCreate: () => void;
  onToggleSidebar: () => void;
  // Só afeta o desktop: quando recolhido, o botão mostra "expandir" (»).
  sidebarCollapsed: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button type="button" onClick={onCreate} className={btnPrimary}>
        + Criar
      </button>

      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={
          sidebarCollapsed ? "Mostrar agendas" : "Ocultar agendas"
        }
        title={sidebarCollapsed ? "Mostrar agendas" : "Ocultar agendas"}
        className="rounded-lg border border-line bg-surface p-2 text-fg-muted transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        {/* No mobile é sempre o menu (abre a gaveta); no desktop vira a seta que
            reflete recolhido/expandido. */}
        <span className="lg:hidden">
          <MenuIcon />
        </span>
        <span className="hidden lg:inline">
          {sidebarCollapsed ? <PanelRightIcon /> : <PanelLeftIcon />}
        </span>
      </button>

      <button
        type="button"
        onClick={onToday}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
      >
        Hoje
      </button>

      <div className="flex items-center">
        <ArrowButton dir="prev" onClick={onPrev} />
        <ArrowButton dir="next" onClick={onNext} />
      </div>

      <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-fg sm:text-lg">
        {label}
      </h2>

      <div
        role="tablist"
        aria-label="Visão do calendário"
        className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5"
      >
        {(["day", "week", "month"] as CalendarView[]).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
                active
                  ? "bg-brand-tint text-risd"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {VIEW_LABEL[v]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ArrowButton({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Anterior" : "Próximo"}
      className="rounded-lg p-2 text-fg-muted transition hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
      </svg>
    </button>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

// Painel com a coluna à ESQUERDA destacada — estado "expandido" (clicar recolhe).
function PanelLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

// Mesmo painel com a coluna "escondida" — estado "recolhido" (clicar expande).
function PanelRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" strokeDasharray="2 2" />
    </svg>
  );
}
