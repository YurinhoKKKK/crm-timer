"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";
import { inputClass, labelClass } from "@/lib/ui";

// PEDIR o e-mail de redefinição de senha. Rota PÚBLICA (liberada no middleware) —
// quem esqueceu a senha não tem sessão. Dispara resetPasswordForEmail com o
// redirectTo apontando para /redefinir-senha em URL ABSOLUTA no MESMO host em que
// o site respondeu (window.location.origin) — se o host divergir do cadastrado no
// Supabase (Auth → URL Configuration), o link do e-mail quebra.
//
// ANTI-ENUMERAÇÃO (requisito de segurança): a resposta ao usuário é SEMPRE a
// mesma, exista ou não conta com aquele e-mail. Revelar "e-mail não cadastrado"
// entregaria a lista de quem tem acesso ao sistema. Por isso mostramos a mesma
// confirmação neutra em qualquer desfecho (inclusive erro), sem vazar em log.
export default function EsqueciSenhaPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // O redirectTo tem de ser absoluto e no mesmo host que respondeu a página.
    const redirectTo = `${window.location.origin}/redefinir-senha`;

    // Ignoramos o resultado de propósito: erro ou sucesso, a mensagem é a mesma
    // (anti-enumeração). Não logamos o e-mail nem o desfecho.
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    setLoading(false);
    setSent(true);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo variant="auto" className="mb-4 h-12 w-auto max-w-[220px]" />
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Redefinir senha
          </h1>
        </div>

        {sent ? (
          // Confirmação NEUTRA — idêntica exista ou não a conta.
          <div className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                ✓
              </div>
              <p className="text-sm text-fg">
                Se existir uma conta com esse e-mail, enviamos um link para
                redefinir a senha.
              </p>
              <p className="text-xs text-fg-subtle">
                O link vale por tempo limitado e só pode ser usado uma vez.
                Confira também a caixa de spam.
              </p>
            </div>
            <Link
              href="/login"
              draggable={false}
              className="block w-full rounded-lg border border-line bg-surface py-2.5 text-center text-sm font-medium text-fg shadow-sm transition hover:border-risd/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
            >
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
          >
            <p className="text-sm text-fg-muted">
              Informe o e-mail da sua conta. Enviaremos um link para você criar
              uma nova senha.
            </p>

            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-risd py-2.5 font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
            >
              {loading ? "Enviando…" : "Enviar link de redefinição"}
            </button>

            <Link
              href="/login"
              draggable={false}
              className="block text-center text-sm text-fg-muted transition hover:text-fg"
            >
              Voltar para o login
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
