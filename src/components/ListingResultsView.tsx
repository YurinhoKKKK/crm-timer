import type { ListingResultView } from "@/lib/listing";
import { marketplaceLabel } from "@/lib/listing";

// Exibe (somente leitura) o entregável de uma listagem finalizada: para cada
// combinação marca × marketplace, o link clicável da planilha OU a justificativa
// de "não feita" (passo 22.1). Reaproveitado no detalhe da tarefa finalizada e,
// depois, na aba "Minhas Listagens".
export default function ListingResultsView({
  results,
  className = "",
}: {
  results: ListingResultView[];
  className?: string;
}) {
  if (results.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
        Listagens entregues
      </p>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface-2">
        {results.map((r, i) => (
          <li
            key={`${r.brandName}-${r.marketplace}-${i}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
          >
            <span className="font-medium text-fg">{r.brandName}</span>
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg-muted">
              {marketplaceLabel(r.marketplace)}
            </span>
            {r.link ? (
              <a
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 break-all text-risd underline decoration-risd/40 underline-offset-2 hover:decoration-risd focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {r.link}
              </a>
            ) : (
              <span className="text-fg-subtle">
                Não feita
                {r.reason ? (
                  <> — <span className="italic text-fg-muted">{r.reason}</span></>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
