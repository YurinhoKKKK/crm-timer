"use client";

import { useEffect } from "react";

// Último recurso: só dispara se o PRÓPRIO layout raiz falhar (os error.tsx de
// segmento cobrem o resto). Substitui o documento inteiro, então precisa de
// <html>/<body> próprios e NÃO pode depender do Tailwind nem do script de tema
// — daí os estilos inline. Neutro e legível em qualquer tema. Sem stack, sem
// mensagem técnica, sem link para área nenhuma; o erro real vai para o console.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] erro fatal ao renderizar:", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1rem",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            Algo deu errado
          </h1>
          <p style={{ marginTop: 8, fontSize: "0.875rem", color: "#475569" }}>
            Tivemos um problema inesperado. Tente de novo.
          </p>
          <div
            style={{
              marginTop: 20,
              display: "flex",
              gap: 8,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: "none",
                background: "#e8482b",
                color: "#fff",
                fontSize: "0.875rem",
                fontWeight: 600,
                padding: "0.5rem 1rem",
              }}
            >
              Tentar de novo
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#0f172a",
                fontSize: "0.875rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
              }}
            >
              Recarregar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
