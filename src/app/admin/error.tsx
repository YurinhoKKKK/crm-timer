"use client";

import { useEffect } from "react";
import ErrorScreen from "@/components/ErrorScreen";

// Boundary de erro da área ADMIN (passo do error.tsx). Cobre /admin e subrotas.
// Converte um erro no render de um destino — que antes travava a navegação
// suave em silêncio — numa tela amigável com recuperação. O erro REAL vai só
// para o console/log (diagnóstico), nunca para a tela.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] erro ao renderizar a tela:", error);
  }, [error]);

  return <ErrorScreen reset={reset} home={{ href: "/admin", label: "Ir para o início" }} />;
}
