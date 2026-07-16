"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { inputClass, labelClass } from "@/lib/ui";
import { clientPortalLogin } from "../actions";

// Tela de senha do portal do cliente. Não revela NADA antes da senha certa —
// nem o nome da empresa (token inválido e senha errada respondem igual).
export default function ClientPortalLogin({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await clientPortalLogin(token, password);
    if (res.error) {
      setError(res.error);
      setLoading(false);
      return;
    }
    // Cookie de sessão gravado — o servidor re-renderiza já com o conteúdo.
    router.refresh();
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-canvas px-4">
      {/* Toggle de tema no canto — mesma preferência persistida do sistema */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {/* Brilho decorativo da marca atrás do cartão */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-risd/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo variant="auto" className="mb-4 h-12 w-auto max-w-[220px]" />
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Portal do cliente
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Digite a senha de acesso fornecida pela Monvatti.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
        >
          <div>
            <label htmlFor="portal-password" className={labelClass}>
              Senha de acesso
            </label>
            <input
              id="portal-password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-risd py-2.5 font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
          >
            {loading ? "Verificando…" : "Entrar"}
          </button>

          <p className="text-center text-xs text-fg-subtle">
            Esqueceu a senha? Fale com o seu consultor Monvatti.
          </p>
        </form>
      </div>
    </main>
  );
}
