"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import FollowupView from "@/components/followup/FollowupView";
import ScoresPanel from "@/components/followup/ScoresPanel";
import type {
  BoardRow,
  FollowupTab,
  MonthOption,
  ScoreMonthRow,
} from "@/lib/followup";

const TZ = "America/Sao_Paulo";

// "Atualizado às HH:MM" — carimbo do último sync OK do Digisac, compartilhado
// pelas duas abas. Deixa claro que o dado é tão fresco quanto a última coleta.
function LastSync({ iso }: { iso: string | null }) {
  if (!iso) {
    return (
      <span className="text-xs text-fg-subtle">Ainda sem sincronização do Digisac</span>
    );
  }
  const t = new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  const d = new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
  });
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
      Atualizado às <span className="tabular-nums">{t}</span> · {d}
    </span>
  );
}

// Casca da tela de Acompanhamento: barra de abas (só admin tem a Pontuação) +
// carimbo de sincronização, e o conteúdo da aba ativa. A aba mora na URL (?aba=),
// como o resto do estado de visão desta tela.
export default function FollowupTabs({
  role,
  tab,
  board,
  boardError,
  lastSync,
  month,
  monthOptions,
  scores,
  scoresError,
}: {
  role: "admin" | "consultor";
  tab: FollowupTab;
  board: BoardRow[];
  boardError: string | null;
  lastSync: string | null;
  month: string;
  monthOptions: MonthOption[];
  scores: ScoreMonthRow[];
  scoresError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filtros de consultor/colaborador do quadro — no pai para sobreviverem à troca
  // de aba e alimentarem o link de exportação da Pontuação (decisão 4). Trocar o
  // consultor zera o colaborador (as opções de colaborador dependem do consultor).
  const [consultantId, setConsultantId] = useState("");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [recovering, setRecovering] = useState(false);

  function onConsultantChange(v: string) {
    setConsultantId(v);
    setCollaboratorId("");
  }

  function goTab(next: FollowupTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "acompanhamento") params.delete("aba");
    else params.set("aba", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const isAdmin = role === "admin";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <div role="tablist" aria-label="Seções do acompanhamento" className="flex rounded-lg border border-line bg-surface p-0.5">
            <TabButton active={tab === "acompanhamento"} onClick={() => goTab("acompanhamento")}>
              Acompanhamento
            </TabButton>
            <TabButton active={tab === "pontuacao"} onClick={() => goTab("pontuacao")}>
              Pontuação
            </TabButton>
          </div>
        ) : (
          <span />
        )}
        <LastSync iso={lastSync} />
      </div>

      {isAdmin && tab === "pontuacao" ? (
        <ScoresPanel
          month={month}
          monthOptions={monthOptions}
          rows={scores}
          error={scoresError}
          consultantId={consultantId}
          collaboratorId={collaboratorId}
          recovering={recovering}
        />
      ) : (
        <FollowupView
          rows={board}
          role={role}
          error={boardError}
          month={month}
          monthOptions={monthOptions}
          consultantId={consultantId}
          onConsultantChange={onConsultantChange}
          collaboratorId={collaboratorId}
          onCollaboratorChange={setCollaboratorId}
          recovering={recovering}
          onRecoveringChange={setRecovering}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
        active ? "bg-brand-tint text-risd" : "text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
