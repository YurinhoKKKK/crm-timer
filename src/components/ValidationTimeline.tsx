import type { ListingValidationItem } from "@/lib/listing";

// Linha do tempo de validação de UMA listagem (passo 33 + ciclo de reajuste):
// estado atual em destaque + todos os eventos (append-only, nunca reescritos),
// do mais recente ao mais antigo, com autor e comentário. Fonte ÚNICA dos
// rótulos/tons — usada na central (admin/consultor) e na tela do colaborador.

export const VALIDATION_LABEL: Record<ListingValidationItem["event"], string> = {
  aprovado: "Aprovada",
  ajuste_solicitado: "Ajuste solicitado",
  contestado: "Gostaria de listar",
  reajuste_feito: "Reajuste feito",
};

export function validationTone(event: ListingValidationItem["event"]): string {
  if (event === "aprovado")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (event === "reajuste_feito")
    return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function authorOf(e: ListingValidationItem): string {
  return e.authorType === "cliente" ? "Cliente" : e.author ?? "Equipe";
}

export default function ValidationTimeline({
  events,
}: {
  events: ListingValidationItem[];
}) {
  if (events.length === 0) return null;
  const latest = events[events.length - 1];

  return (
    <details className="mt-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${validationTone(
            latest.event
          )}`}
        >
          {VALIDATION_LABEL[latest.event]}
        </span>
        <span className="text-fg-subtle">
          {authorOf(latest)} · {formatDateTime(latest.at)}
        </span>
        {events.length > 1 && (
          <span className="text-fg-subtle">· histórico ({events.length})</span>
        )}
      </summary>
      <ol className="mt-2 space-y-2 border-t border-line pt-2">
        {[...events].reverse().map((e, i) => (
          <li key={i} className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${validationTone(
                  e.event
                )}`}
              >
                {VALIDATION_LABEL[e.event]}
              </span>
              <span className="text-fg-subtle">
                {authorOf(e)} · {formatDateTime(e.at)}
              </span>
            </div>
            {e.comment && <p className="mt-1 text-fg-muted">“{e.comment}”</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
