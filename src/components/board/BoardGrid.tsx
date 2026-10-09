"use client";

import type { CSSProperties, ReactNode } from "react";

// =====================================================================
// Esqueleto de TABELA dos quadros em grade (CS e Tráfego): cabeçalho de colunas +
// linhas, em CSS grid, com coluna(s) fixa(s) à esquerda. A ESTRUTURA mora aqui
// (fonte única); cada quadro passa seu array de colunas e seu contexto de célula.
//
// Dois modos:
//   - default (CS): cada seção rola sozinha — a tabela traz seu PRÓPRIO
//     `overflow-x-auto` + `min-width`. Marcação idêntica à que o CS já usava.
//   - compact (Tráfego): linhas mais baixas e SEM rolagem própria — a rolagem
//     horizontal é ÚNICA para o quadro inteiro (um `overflow-x-auto` em volta de
//     todas as seções, no componente do quadro), então aqui `scroll={false}`.
//
// Coluna fixa: `stickyLeft` (deslocamento em px). `borderRight` desenha o divisor
// no fim do bloco fixo. Assim o CS fixa só "Empresa" (stickyLeft 0) e o Tráfego
// fixa "alça + Empresa" (0 e 24) como um bloco só.
// =====================================================================

export type BoardColumn<Row, Ctx> = {
  id: string;
  label: string;
  width: string;
  align: "left" | "center" | "right";
  // Deslocamento da coluna fixa (px). undefined = coluna normal (rola).
  stickyLeft?: number;
  // Divisor à direita (fim do bloco fixo).
  borderRight?: boolean;
  // Padding horizontal menor (px-2 em vez de px-3) — colunas apertadas (Ações).
  tight?: boolean;
  cell: (row: Row, ctx: Ctx) => ReactNode;
};

function alignClass(a: BoardColumn<unknown, unknown>["align"]): string {
  return a === "right"
    ? "justify-end text-right"
    : a === "center"
      ? "justify-center text-center"
      : "justify-start text-left";
}

// Classe + estilo da parte "fixa" de uma célula (cabeçalho ou linha). `bg` troca
// porque a célula fixa precisa cobrir o conteúdo que rola por baixo dela. Recebe
// só os campos relevantes (evita variância do `cell` genérico).
function stickyParts(
  col: { stickyLeft?: number; borderRight?: boolean },
  bg: string
): { className: string; style?: CSSProperties } {
  if (col.stickyLeft === undefined) return { className: "" };
  const left = col.stickyLeft === 0 ? "left-0" : "";
  const border = col.borderRight ? "border-r border-line" : "";
  return {
    className: `sticky z-[1] ${left} ${border} ${bg}`,
    style: col.stickyLeft > 0 ? { left: col.stickyLeft } : undefined,
  };
}

export default function BoardGrid<Row extends { id: string }, Ctx>({
  columns,
  rows,
  ctx,
  minWidth,
  compact = false,
  scroll = true,
}: {
  columns: BoardColumn<Row, Ctx>[];
  rows: Row[];
  ctx: Ctx;
  minWidth: number;
  compact?: boolean;
  scroll?: boolean;
}) {
  const template = columns.map((c) => c.width).join(" ");
  const padY = compact ? "py-2" : "py-3";

  const body = (
    <>
      <div
        className="grid items-center border-b border-line"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((col) => {
          const s = stickyParts(col, "bg-surface");
          return (
            <div
              key={col.id}
              style={s.style}
              className={`flex ${col.tight ? "px-2" : "px-3"} py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle ${
                compact ? "whitespace-nowrap" : ""
              } ${alignClass(col.align)} ${s.className}`}
            >
              {col.label}
            </div>
          );
        })}
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          className="group/row grid border-b border-line transition last:border-b-0 hover:bg-surface-2"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((col) => {
            const s = stickyParts(col, "bg-surface group-hover/row:bg-surface-2");
            return (
              <div
                key={col.id}
                style={s.style}
                className={`flex items-center ${col.tight ? "px-2" : "px-3"} ${padY} text-sm ${alignClass(
                  col.align
                )} ${s.className}`}
              >
                {col.cell(row, ctx)}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );

  // default (CS): a própria seção rola; compact (Tráfego): rolagem única externa.
  if (scroll) {
    return (
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>{body}</div>
      </div>
    );
  }
  return body;
}
