"use client";

import { useEffect } from "react";
import ErrorScreen from "@/components/ErrorScreen";

// Boundary de erro da área CONSULTOR (passo do error.tsx). Cobre /consultor e
// subrotas. O erro real vai só para o console/log; a tela é neutra e estática.
export default function ConsultorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[consultor] erro ao renderizar a tela:", error);
  }, [error]);

  return (
    <ErrorScreen reset={reset} home={{ href: "/consultor", label: "Ir para o início" }} />
  );
}
