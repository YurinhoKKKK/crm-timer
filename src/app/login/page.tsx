"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";
import { inputClass, labelClass } from "@/lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "register") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError("Email ou senha incorretos.");
        setLoading(false);
        return;
      }
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="sidebar-rail mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold text-white shadow-card">
            M
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            CRM/Timer
          </h1>
          <p className="mt-1 text-sm text-fg-muted">Monvatti</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
        >
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                mode === "login"
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                mode === "register"
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Criar conta
            </button>
          </div>

          {mode === "register" && (
            <div>
              <label htmlFor="full-name" className={labelClass}>
                Nome completo
              </label>
              <input
                id="full-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
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
            {loading
              ? "Aguarde…"
              : mode === "login"
              ? "Entrar"
              : "Criar conta"}
          </button>

          {mode === "register" && (
            <p className="text-center text-xs text-fg-subtle">
              Após criar a conta, um administrador precisa atribuir seu cargo.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
