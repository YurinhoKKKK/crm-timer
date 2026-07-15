"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { inputClass, labelClass, btnPrimary, btnSecondary } from "@/lib/ui";
import { clientPortalPath, type ClientAccessInfo } from "@/lib/client-portal";
import {
  setClientAccess,
  rotateClientAccess,
  revokeClientAccess,
} from "@/app/client-access-actions";

// Gestão do ACESSO DO CLIENTE (passo 25), na central da empresa — admin e
// consultor. Cria o link + senha, copia o link, redefine a senha, gira o
// token (novo link) e revoga. A senha digitada aqui não é exibida de volta
// (só o hash existe no banco); quem esquecer redefine.
export default function ClientAccessManager({
  companyId,
  access,
}: {
  companyId: string;
  access: ClientAccessInfo | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const activeAccess = access?.active ? access : null;
  const link = activeAccess
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${clientPortalPath(activeAccess.token)}`
    : null;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setSaving(true);
    const res = await setClientAccess(companyId, password);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setPassword("");
    setConfirm("");
    setShowPasswordForm(false);
    refresh();
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem clipboard (http/permite negada): o campo fica selecionável.
    }
  }

  const passwordForm = (
    <form
      onSubmit={savePassword}
      className="mt-4 space-y-4 rounded-lg border border-risd/40 bg-surface-2/40 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="cp-pass" className={labelClass}>
            {activeAccess ? "Nova senha" : "Senha de acesso"}
          </label>
          <input
            id="cp-pass"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="cp-pass2" className={labelClass}>
            Confirmar senha
          </label>
          <input
            id="cp-pass2"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-fg-subtle">
        Mínimo de 8 caracteres. {activeAccess && "Redefinir a senha encerra as sessões abertas do cliente."}
      </p>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving
            ? "Salvando…"
            : activeAccess
              ? "Salvar nova senha"
              : "Criar acesso"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowPasswordForm(false);
            setPassword("");
            setConfirm("");
            setError(null);
          }}
          className={btnSecondary}
        >
          Cancelar
        </button>
      </div>
    </form>
  );

  if (!activeAccess) {
    return (
      <div>
        <p className="text-sm text-fg-muted">
          {access && !access.active
            ? "O acesso desta empresa está revogado. Crie uma nova senha para reativar o link."
            : "Esta empresa ainda não tem acesso de cliente. Crie uma senha para gerar o link exclusivo."}
        </p>
        {showPasswordForm ? (
          passwordForm
        ) : (
          <button
            type="button"
            onClick={() => setShowPasswordForm(true)}
            className={`${btnPrimary} mt-4`}
          >
            {access && !access.active ? "Reativar acesso" : "Criar acesso do cliente"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="cp-link" className={labelClass}>
        Link exclusivo do cliente
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="cp-link"
          type="text"
          readOnly
          value={link ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} flex-1 font-mono text-xs`}
        />
        <button type="button" onClick={copyLink} className={btnSecondary}>
          {copied ? "Copiado!" : "Copiar link"}
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        Envie o link e a senha por canais separados. O cliente vê SOMENTE as
        listagens (com link ou com a justificativa de não publicada) e as
        anotações marcadas como “visível ao cliente”.
      </p>

      {showPasswordForm ? (
        passwordForm
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPasswordForm(true)}
            className={btnSecondary}
          >
            Redefinir senha
          </button>
          <button
            type="button"
            onClick={() => setConfirmRotate(true)}
            className={btnSecondary}
          >
            Gerar novo link
          </button>
          <button
            type="button"
            onClick={() => setConfirmRevoke(true)}
            className="rounded-lg border border-red-300/60 bg-surface px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            Revogar acesso
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Gerar novo link?"
        description="O link atual para de funcionar imediatamente e as sessões abertas do cliente são encerradas. A senha continua a mesma."
        confirmLabel="Gerar novo link"
        tone="primary"
        onConfirm={async () => {
          const res = await rotateClientAccess(companyId);
          if (res.error) return { error: res.error };
          refresh();
        }}
      />

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title="Revogar o acesso do cliente?"
        description="O link deixa de funcionar e as sessões abertas são encerradas. Você pode reativar depois criando uma nova senha."
        confirmLabel="Revogar acesso"
        onConfirm={async () => {
          const res = await revokeClientAccess(companyId);
          if (res.error) return { error: res.error };
          refresh();
        }}
      />
    </div>
  );
}
