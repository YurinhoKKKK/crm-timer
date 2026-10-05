// Faixa de aviso "cliente em grupo parado". Presentacional (sem estado, sem
// "use client") — serve a server components (central da empresa, tela do
// colaborador) E a client components (formulário de nova tarefa). O sinal NÃO é
// só a cor: há ícone + texto, para quem não distingue a cor âmbar. Ver fluxo de
// grupos (kind='paused'): Pausados, Cancelados, Aguardando Renovação, etc.
export default function PausedCompanyBanner({
  groupName,
  className = "",
}: {
  groupName: string;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="10" y1="9" x2="10" y2="15" />
        <line x1="14" y1="9" x2="14" y2="15" />
      </svg>
      <span>
        Este cliente está no grupo <strong className="font-semibold">{groupName}</strong>.
      </span>
    </div>
  );
}
