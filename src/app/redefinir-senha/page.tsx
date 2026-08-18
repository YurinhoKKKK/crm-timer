"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";
import { inputClass, labelClass } from "@/lib/ui";

// DEFINIR a nova senha. Rota PÚBLICA (liberada no middleware) — este é o ponto
// onde o fluxo costuma falhar:
//
//  · O Supabase devolve o token no FRAGMENTO (#access_token/#refresh_token, fluxo
//    implícito) OU como ?code= (fluxo PKCE — o padrão do @supabase/ssr). O
//    FRAGMENTO NUNCA chega ao servidor: só existe no navegador. Se o middleware
//    tratasse esta rota como protegida e redirecionasse para /login, o fragmento
//    seria DESCARTADO no redirect e o token se perderia. Por isso a rota é pública
//    e a leitura do token é feita AQUI, no CLIENTE.
//
//  · Tratamos os DOIS formatos. E como o createBrowserClient tem
//    detectSessionInUrl ligado, o próprio SDK pode consumir o token antes do nosso
//    código — então checamos getSession() primeiro e escutamos onAuthStateChange,
//    para não depender de quem chega antes nem consumir o código duas vezes.

type Phase = "verifying" | "form" | "expired" | "invalid" | "success";

export default function RedefinirSenhaPage() {
  const supabase = createClient();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Evita que uma corrida (SDK x tratamento manual) sobrescreva um estado já
  // resolvido, e que o token/erro fique no histórico do navegador.
  const settled = useRef(false);

  useEffect(() => {
    let active = true;

    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash
    );
    const queryParams = new URLSearchParams(window.location.search);

    // Tira token/erro da URL (histórico e re-processamento) sem recarregar.
    const cleanUrl = () =>
      window.history.replaceState(null, "", window.location.pathname);

    const settle = (next: Phase) => {
      if (!active || settled.current) return;
      settled.current = true;
      cleanUrl();
      setPhase(next);
    };

    // Erro pode voltar tanto no fragmento quanto na query. otp_expired é o caso
    // comum: scanner de link de e-mail corporativo abre (e QUEIMA) o token antes
    // do usuário. Não há token para consumir aqui — só classificamos.
    const errorCode =
      hashParams.get("error_code") || queryParams.get("error_code");
    const errorParam = hashParams.get("error") || queryParams.get("error");
    if (errorCode || errorParam) {
      settle(errorCode === "otp_expired" ? "expired" : "invalid");
      return;
    }

    // Corrida: se o SDK já estabeleceu a sessão de recuperação, mostramos o form.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        settle("form");
      }
    });

    (async () => {
      // 1) O detectSessionInUrl do SDK pode ter criado a sessão antes de nós.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) return settle("form");

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = queryParams.get("code");

      // 2) Fluxo implícito: tokens no fragmento.
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!active) return;
        return settle(error ? classify(error.message) : "form");
      }

      // 3) Fluxo PKCE: ?code= trocado por sessão.
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (!error) return settle("form");
        // Pode ter falhado porque o SDK já trocou o code na corrida — confere.
        const {
          data: { session: raced },
        } = await supabase.auth.getSession();
        if (raced) return settle("form");
        return settle(classify(error.message));
      }

      // 4) Nenhum token reconhecível. Se o listener não resolver logo, é link
      //    inválido/ausente (damos um instante para a corrida do SDK).
      setTimeout(() => settle("invalid"), 400);
    })();

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password.length < 6) {
      setFormError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setFormError("As senhas não coincidem.");
      return;
    }

    setSaving(true);
    // A sessão de recuperação já está ativa; updateUser troca a senha e MANTÉM o
    // usuário autenticado. Erro de senha fraca NÃO perde o token (a sessão segue).
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      setFormError(
        /weak|short|least|password/i.test(error.message)
          ? "Senha muito fraca. Escolha uma senha mais forte."
          : "Não foi possível salvar a senha. Tente novamente."
      );
      return;
    }

    setPhase("success");
    router.refresh();
    // A troca cria sessão: levamos ao sistema já autenticado (/ roteia por cargo).
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1600);
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
            Nova senha
          </h1>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          {phase === "verifying" && (
            <p className="py-6 text-center text-sm text-fg-subtle">
              Validando o link…
            </p>
          )}

          {(phase === "expired" || phase === "invalid") && (
            <div className="space-y-4 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                !
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-fg">
                  {phase === "expired"
                    ? "Este link expirou ou já foi usado."
                    : "Link inválido ou incompleto."}
                </p>
                <p className="text-xs text-fg-subtle">
                  {phase === "expired"
                    ? "O link de redefinição vale por tempo limitado e só pode ser usado uma vez. Peça um novo para continuar."
                    : "Não encontramos um token de redefinição válido nesta página. Peça um novo link."}
                </p>
              </div>
              <Link
                href="/esqueci-senha"
                draggable={false}
                className="block w-full rounded-lg bg-risd py-2.5 font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Pedir um novo link
              </Link>
              <Link
                href="/login"
                draggable={false}
                className="block text-sm text-fg-muted transition hover:text-fg"
              >
                Voltar para o login
              </Link>
            </div>
          )}

          {phase === "success" && (
            <div className="space-y-3 py-2 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                ✓
              </div>
              <p className="text-sm font-medium text-fg">Senha alterada!</p>
              <p className="text-xs text-fg-subtle">
                Entrando no sistema…
              </p>
            </div>
          )}

          {phase === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-fg-muted">
                Escolha uma nova senha para a sua conta.
              </p>

              <div>
                <label htmlFor="password" className={labelClass}>
                  Nova senha
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="confirm" className={labelClass}>
                  Confirmar nova senha
                </label>
                <input
                  id="confirm"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputClass}
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-risd py-2.5 font-semibold text-white shadow-sm transition hover:bg-chrysler focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

// Classifica a falha de troca do token. Um link vencido/queimado costuma trazer
// "expired" na mensagem; o resto cai em "invalid" — os dois têm a mesma saída
// (pedir um novo link), mas o texto fica mais honesto.
function classify(message: string): Phase {
  return /expired|otp/i.test(message) ? "expired" : "invalid";
}
