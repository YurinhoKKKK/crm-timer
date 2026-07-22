"use client";

import { useEffect } from "react";
import ErrorScreen from "@/components/ErrorScreen";

// Fallback de erro da RAIZ: pega o que não tem boundary mais específico
// (/login, /perfil, /pending) e também qualquer boundary aninhado que falhe.
// Fica NEUTRO de propósito — sem link para nenhuma área — para nunca rotear
// ninguém (nem um cliente) para dentro de uma área que não é a dele. Só
// "tentar de novo". O erro real vai para o console/log, nunca para a tela.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] erro ao renderizar a tela:", error);
  }, [error]);

  return <ErrorScreen reset={reset} />;
}
