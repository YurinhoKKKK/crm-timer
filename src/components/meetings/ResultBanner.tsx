"use client";

// Banner de resultado de uma ação de reunião: verde quando tudo certo, âmbar
// quando salvou mas há um aviso (ex.: Google não sincronizou). Fechável.
// Compartilhado entre criar (NewMeetingForm) e editar/excluir/enviar (MeetingCard).
export default function ResultBanner({
  warning,
  successText,
  onClose,
}: {
  warning: string | null;
  successText: string;
  onClose: () => void;
}) {
  return (
    <div
      className={`mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
        warning
          ? "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          : "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
      }`}
    >
      <span>{warning ?? successText}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        className="shrink-0 rounded p-0.5 text-current/70 transition hover:text-current"
      >
        ✕
      </button>
    </div>
  );
}
