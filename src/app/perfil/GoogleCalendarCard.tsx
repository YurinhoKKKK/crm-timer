"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary } from "@/lib/ui";

// Cartão de conexão do Google Calendar no perfil.
// - Conectar: link direto para /api/google/connect (GET que redireciona ao
//   Google). O state assinado protege o retorno; iniciar não precisa de CSRF.
// - Desconectar: POST /api/google/disconnect (revoga no Google + apaga a linha).
// - Aviso de divergência: se a conta Google conectada difere do e-mail do
//   sistema, mostra alerta NÃO bloqueante — transforma o e-mail em segurança,
//   não só informação (evita reunião nascendo na agenda errada).

function formatBRT(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function GoogleCalendarCard({
  connected,
  googleEmail,
  connectedAt,
  emailMismatch,
  systemEmail,
  flashStatus,
  flashMsg,
}: {
  connected: boolean;
  googleEmail: string | null;
  connectedAt: string | null;
  emailMismatch: boolean;
  systemEmail: string;
  flashStatus: "connected" | "error" | null;
  flashMsg: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/google/disconnect", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Não foi possível desconectar. Tente de novo.");
        return;
      }
      // Limpa ?google=connected|error da URL ANTES de revalidar: esse flash é
      // derivado da query, não do banco, e sobreviveria ao refresh (reaparecendo
      // "conectado" mesmo com a linha já apagada). replace troca a URL sem
      // empilhar histórico; refresh rebusca o estado real do servidor.
      startTransition(() => {
        router.replace("/perfil");
        router.refresh();
      });
    } catch {
      setError("Falha de rede ao desconectar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold text-fg">Google Calendar</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Conecte sua conta para que as reuniões que você criar apareçam na sua
          agenda do Google. O sistema não lê sua agenda.
        </p>
      </div>

      {/* Retorno do fluxo (?google=...) */}
      {flashStatus === "connected" && (
        <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          Conta do Google conectada.
        </p>
      )}
      {flashStatus === "error" && flashMsg && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {flashMsg}
        </p>
      )}

      {connected ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
            <span className="text-fg-muted">Conectado</span>
            {googleEmail ? (
              <>
                {" como "}
                <span className="font-medium text-fg">{googleEmail}</span>
              </>
            ) : null}
            {connectedAt ? (
              <span className="text-fg-subtle"> · desde {formatBRT(connectedAt)}</span>
            ) : null}
          </div>

          {/* Aviso de divergência de conta — não bloqueante */}
          {emailMismatch && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">
                Você conectou uma conta diferente da que usa no sistema.
              </p>
              <p className="mt-1">
                Conta conectada: <span className="font-medium">{googleEmail}</span>
                <br />
                Seu e-mail no sistema:{" "}
                <span className="font-medium">{systemEmail}</span>
              </p>
              <p className="mt-2">
                Confirme se é essa conta mesmo que você quer usar para as
                reuniões. Se não for, desconecte e conecte de novo escolhendo a
                conta certa.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="select-none rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg-muted shadow-sm transition hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-red-300"
            >
              {busy ? "Desconectando…" : "Desconectar"}
            </button>
            <a href="/api/google/connect" className={btnSecondary}>
              Reconectar com outra conta
            </a>
          </div>
        </div>
      ) : (
        <div>
          <a href="/api/google/connect" className={btnPrimary}>
            Conectar Google Calendar
          </a>
        </div>
      )}
    </section>
  );
}
