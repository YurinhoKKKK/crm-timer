"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

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
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-medium text-ink">CRM/Timer</h1>
          <p className="text-sm text-ink/50 mt-1">Monvatti</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl border border-ink/10 p-6 space-y-4"
        >
          <div className="flex gap-1 p-1 bg-ink/5 rounded-lg text-sm">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 py-1.5 rounded-md transition ${
                mode === "login" ? "bg-white shadow-sm" : "text-ink/50"
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 py-1.5 rounded-md transition ${
                mode === "register" ? "bg-white shadow-sm" : "text-ink/50"
              }`}
            >
              Criar conta
            </button>
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-sm text-ink/60 mb-1">
                Nome completo
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-brand focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-sm text-ink/60 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-ink/60 mb-1">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-brand focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-brand text-white font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {loading
              ? "Aguarde..."
              : mode === "login"
              ? "Entrar"
              : "Criar conta"}
          </button>

          {mode === "register" && (
            <p className="text-xs text-ink/40 text-center">
              Após criar a conta, um administrador precisa atribuir seu cargo.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
