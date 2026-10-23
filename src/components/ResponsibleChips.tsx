"use client";

import Avatar from "@/components/Avatar";

// Balões de responsáveis por empresa — FONTE ÚNICA, usada em todas as telas onde
// a empresa aparece com seus responsáveis. Diferencia CONSULTOR de COLABORADOR
// por forma + ícone (nunca só por cor, para acessibilidade e temas claro/escuro):
//   • Consultor: o chip cinza preenchido de sempre (Avatar + nome).
//   • Colaborador: chip só com CONTORNO (tom violeta, que não colide com as
//     etiquetas nem com o verde/amarelo/vermelho do Acompanhamento) + ícone de
//     ferramenta antes do nome.
//   • Ambos (mesma pessoa consultor E colaborador): UM chip, com os dois
//     indicadores (base cinza preenchida + contorno violeta + ferramenta).
// Ordem: consultores, divisor fino, colaboradores. `showEmptyCollaborator` mostra
// um chip apagado "Sem colaborador" (só o Quadro de Empresas usa).

export type ResponsiblePerson = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type Kind = "consultor" | "colaborador" | "ambos";

const TITLE: Record<Kind, string> = {
  consultor: "Consultor responsável",
  colaborador: "Colaborador responsável",
  ambos: "Consultor e colaborador responsável",
};

// Ícone de ferramenta (chave inglesa) — marca visual do COLABORADOR. Tamanho pelo
// className (h/w). Exportado para o chip de NPS do Sucesso do Cliente reusar a
// mesma marca.
export function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function Chip({
  person,
  kind,
  size,
}: {
  person: ResponsiblePerson;
  kind: Kind;
  size: number;
}) {
  const tone =
    kind === "consultor"
      ? "border-line bg-surface-2 text-fg-muted"
      : kind === "colaborador"
      ? "border-violet-400/60 bg-transparent text-violet-700 dark:border-violet-400/50 dark:text-violet-300"
      : // ambos: base cinza (consultor) + contorno violeta (colaborador)
        "border-violet-400/60 bg-surface-2 text-fg-muted";
  return (
    <span
      title={TITLE[kind]}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2 text-xs ${tone}`}
    >
      <Avatar name={person.name || "?"} url={person.avatarUrl ?? undefined} size={size} />
      {kind !== "consultor" && (
        <WrenchIcon className="h-3 w-3 shrink-0 text-violet-600 dark:text-violet-300" />
      )}
      <span className="truncate">{person.name || "(sem nome)"}</span>
    </span>
  );
}

function EmptyCollaboratorChip() {
  return (
    <span
      title="Sem colaborador responsável"
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 text-xs italic text-fg-subtle"
    >
      <WrenchIcon className="h-3 w-3 shrink-0 opacity-50" />
      Sem colaborador
    </span>
  );
}

export default function ResponsibleChips({
  consultants,
  collaborators,
  showEmptyCollaborator = false,
  size = 18,
  className,
}: {
  consultants: ResponsiblePerson[];
  collaborators: ResponsiblePerson[];
  showEmptyCollaborator?: boolean;
  size?: number;
  className?: string;
}) {
  const collabIds = new Set(collaborators.map((c) => c.id));
  const consultantIds = new Set(consultants.map((c) => c.id));

  // Lado esquerdo = consultores (cada um é 'consultor' ou 'ambos' se também for
  // colaborador). Lado direito = colaboradores que NÃO são consultores (os
  // 'ambos' já saíram do lado esquerdo).
  const left = consultants.map((p) => ({
    person: p,
    kind: (collabIds.has(p.id) ? "ambos" : "consultor") as Kind,
  }));
  const right = collaborators.filter((c) => !consultantIds.has(c.id));

  const emptyColab = showEmptyCollaborator && collaborators.length === 0;
  const hasRight = right.length > 0 || emptyColab;

  if (left.length === 0 && !hasRight) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {left.map(({ person, kind }) => (
        <Chip key={`c:${person.id}`} person={person} kind={kind} size={size} />
      ))}
      {left.length > 0 && hasRight && (
        <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      )}
      {right.map((person) => (
        <Chip key={`k:${person.id}`} person={person} kind="colaborador" size={size} />
      ))}
      {emptyColab && <EmptyCollaboratorChip />}
    </div>
  );
}
