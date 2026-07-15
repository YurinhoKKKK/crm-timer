"use client";

import { useState, type ReactNode } from "react";
import TaskDetailSheet from "@/components/TaskDetailSheet";

// Torna QUALQUER representação de tarefa clicável: renderiza um botão com o
// conteúdo recebido e abre o painel de detalhe unificado (TaskDetailSheet).
// Autocontido (estado próprio), então serve tanto listas client quanto seções
// renderizadas no servidor — basta envolver o card/linha da tarefa.
export default function TaskDetailLink({
  taskId,
  className = "",
  children,
}: {
  taskId: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && (
        <TaskDetailSheet taskId={taskId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
