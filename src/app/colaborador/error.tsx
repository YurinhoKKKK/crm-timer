"use client";

import { useEffect } from "react";
import ErrorScreen from "@/components/ErrorScreen";

// Boundary de erro da área COLABORADOR (passo do error.tsx). Cobre /colaborador
// e subrotas — inclusive a tela de execução da tarefa, destino do botão que
// travava. O erro real vai só para o console/log; a tela é neutra e estática.
export default function ColaboradorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[colaborador] erro ao renderizar a tela:", error);
  }, [error]);

  return (
    <ErrorScreen reset={reset} home={{ href: "/colaborador", label: "Ir para o início" }} />
  );
}
