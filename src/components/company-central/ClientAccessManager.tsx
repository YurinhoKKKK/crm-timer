"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { labelClass, btnPrimary, btnSecondary } from "@/lib/ui";
import {
  clientPortalPath,
  ACCESS_ACTION_LABEL,
  type ClientAccessView,
} from "@/lib/client-portal";
import {
  generateClientAccess,
  rotateClientAccess,
  revokeClientAccess,
} from "@/app/client-access-actions";

// Gestão do ACESSO DO CLIENTE na central da empresa (passos 25 e 30).
//
// Duas faces, decididas pelo CARGO no servidor (ClientAccessView):
//  · admin     — link, ações, histórico, e a revelação única da senha.
//  · consultor — apenas se existe/está ativo, sem nenhuma credencial. Não é
//                esta tela que esconde o token: a consulta do consultor não
//                tem como devolvê-lo (função que só lê dois booleanos).
//
// A senha em claro aparece UMA ÚNICA VEZ, no retorno da geração, e vive só no
// estado desta tela. Recarregar a página a perde para sempre — de propósito:
// se ela vazar, o caminho é REDEFINIR, o que derruba o acesso do cliente e
// deixa rastro na auditoria. Deixa de ser um golpe silencioso.

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className ?? btnSecondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Sem clipboard (http ou permissão negada): o campo é selecionável.
        }
      }}
    >
      {copied ? "Copiado!" : label}
    </button>
  );
}

export default function ClientAccessManager({
  companyId,
  view,
  previewHref,
}: {
  companyId: string;
  view: ClientAccessView;
  // "Ver como cliente" — pré-visualização autenticada, sem token e sem senha.
  previewHref: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Senha recém-gerada: existe apenas aqui, apenas nesta sessão de tela.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const previewButton = (
    <Link href={previewHref} className={btnSecondary}>
      Ver como cliente
    </Link>
  );

  // --- Consultor: estado, sem credencial -----------------------------------
  if (view.role === "consultor") {
    const { exists, active } = view.status;
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill active={active} exists={exists} />
        </div>
        <p className="mt-3 text-sm text-fg-muted">
          O link e a senha do cliente são gerados e entregues pelo
          administrador. Você pode conferir exatamente o que o cliente enxerga
          pela pré-visualização.
        </p>
        <div className="mt-4">{previewButton}</div>
      </div>
    );
  }

  // --- Admin ---------------------------------------------------------------
  const { access, audit } = view;
  const activeAccess = access?.active ? access : null;
  const link = activeAccess
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${clientPortalPath(activeAccess.token)}`
    : null;

  async function doGenerate() {
    setError(null);
    setGenerating(true);
    const res = await generateClientAccess(companyId);
    setGenerating(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRevealed(res.password ?? null);
    refresh();
  }

  // Bloco da revelação: o momento mais delicado da tela. Senha grande e
  // legível, cópia em um clique, e o aviso de "só desta vez" claro sem ser
  // alarmista.
  const revealBlock = revealed && (
    <div className="mt-4 rounded-xl border border-risd/40 bg-brand-tint/60 p-4 dark:bg-risd/10">
      <p className="text-sm font-semibold text-fg">
        Senha gerada — anote agora
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        Esta é a única vez que a senha aparece. Ela não fica guardada em lugar
        nenhum: se precisar dela de novo, o caminho é redefinir.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 select-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-lg tracking-wide text-fg">
          {revealed}
        </code>
        <CopyButton value={revealed} label="Copiar senha" className={btnPrimary} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRevealed(null)}
          className="text-xs font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          Já anotei, ocultar
        </button>
      </div>
    </div>
  );

  if (!activeAccess) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill active={false} exists={!!access} />
        </div>
        <p className="mt-3 text-sm text-fg-muted">
          {access
            ? "O acesso desta empresa está revogado. Gerar um novo acesso cria uma senha nova e reativa o link."
            : "Esta empresa ainda não tem acesso de cliente. Ao gerar, o sistema sorteia a senha e a mostra uma única vez."}
        </p>

        {revealBlock}

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={doGenerate}
            disabled={generating}
            className={btnPrimary}
          >
            {generating
              ? "Gerando…"
              : access
                ? "Gerar novo acesso"
                : "Criar acesso do cliente"}
          </button>
          {previewButton}
        </div>

        <AuditList entries={audit} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill active exists />
        <span className="text-xs text-fg-subtle">
          Criado em {formatDateTime(activeAccess.createdAt)}
          {activeAccess.createdBy ? ` por ${activeAccess.createdBy}` : ""}
        </span>
      </div>

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
          className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-fg shadow-sm focus:border-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        />
        <CopyButton value={link ?? ""} label="Copiar link" />
      </div>

      <p className="mt-2 text-xs text-fg-subtle">
        Entregue o link e a senha ao cliente por canais separados. O sistema
        não envia e-mail: a entrega é manual. O cliente vê SOMENTE as
        listagens, o andamento curado e as anotações marcadas “visível ao
        cliente”.
      </p>

      {/* Senha do modelo antigo: escolhida por uma pessoa, que a conhece. */}
      {!activeAccess.passwordGenerated && (
        <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          A senha deste acesso foi definida no modelo antigo, digitada por uma
          pessoa — ou seja, quem a criou ainda a conhece. Redefinir passa a
          usar uma senha sorteada pelo sistema, que ninguém guarda.
        </p>
      )}
      {activeAccess.passwordGenerated && activeAccess.passwordSetAt && (
        <p className="mt-3 text-xs text-fg-subtle">
          Senha definida em {formatDateTime(activeAccess.passwordSetAt)}
          {activeAccess.passwordSetBy ? ` por ${activeAccess.passwordSetBy}` : ""}.
          Não é recuperável — se o cliente perder, redefina.
        </p>
      )}

      {revealBlock}

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Ações separadas por peso: pré-visualizar é leve; redefinir e revogar
          derrubam o acesso do cliente, então pedem confirmação explícita. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {previewButton}
        <button
          type="button"
          onClick={() => setConfirmGenerate(true)}
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

      <AuditList entries={audit} />

      <ConfirmDialog
        open={confirmGenerate}
        onClose={() => setConfirmGenerate(false)}
        title="Redefinir a senha do cliente?"
        description="O sistema sorteia uma senha nova e a mostra uma única vez. A senha atual para de funcionar imediatamente e as sessões abertas do cliente são encerradas — ele precisará da nova senha para voltar a entrar."
        confirmLabel="Redefinir senha"
        tone="primary"
        onConfirm={async () => {
          const res = await generateClientAccess(companyId);
          if (res.error) return { error: res.error };
          setRevealed(res.password ?? null);
          refresh();
        }}
      />

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
        description="O link deixa de funcionar e as sessões abertas são encerradas. Você pode reativar depois gerando um novo acesso, o que cria uma senha nova."
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

function StatusPill({ active, exists }: { active: boolean; exists: boolean }) {
  const label = !exists ? "Sem acesso" : active ? "Ativo" : "Revogado";
  const tone = !exists
    ? "bg-surface-2 text-fg-subtle"
    : active
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      : "bg-surface-2 text-fg-muted";
  const dot = !exists ? "bg-fg-subtle" : active ? "bg-emerald-500" : "bg-fg-subtle";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

// Histórico de quem gerou, redefiniu, girou ou revogou — e quando. As linhas
// são gravadas só pelas funções SECURITY DEFINER e não têm policy de UPDATE
// nem DELETE: ninguém edita nem apaga o próprio rastro.
function AuditList({
  entries,
}: {
  entries: { id: string; action: keyof typeof ACCESS_ACTION_LABEL; actor: string; at: string }[];
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  const shown = open ? entries : entries.slice(0, 3);

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
        Histórico do acesso
      </p>
      <ol className="mt-2 space-y-1.5">
        {shown.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-medium text-fg">
              {ACCESS_ACTION_LABEL[e.action]}
            </span>
            <span className="text-fg-muted">por {e.actor}</span>
            <span className="text-fg-subtle">· {formatDateTime(e.at)}</span>
          </li>
        ))}
      </ol>
      {entries.length > 3 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-xs font-medium text-risd underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd"
        >
          {open ? "Ver menos" : `Ver todas (${entries.length})`}
        </button>
      )}
    </div>
  );
}
