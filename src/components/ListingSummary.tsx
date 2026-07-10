import type { ListingDetails } from "@/lib/listing";
import { marketplaceLabel } from "@/lib/listing";

// Exibição (somente leitura) dos dados de uma "Listagem de marcas" (passo 22):
// marcas pesquisadas, marketplaces e se há cálculo de margem (com a alíquota).
// O sistema apenas registra — nenhum cálculo é feito aqui.
export default function ListingSummary({
  listing,
  className = "",
}: {
  listing: ListingDetails;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`}
    >
      <h2 className="mb-4 font-semibold text-fg">Listagem de marcas</h2>

      <div className="space-y-4 text-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Marcas
          </p>
          {listing.brands.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {listing.brands.map((brand) => (
                <li
                  key={brand.id}
                  className="rounded-full border border-line bg-surface-2 px-3 py-1 text-fg"
                >
                  {brand.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-fg-muted">Nenhuma marca.</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Marketplaces
          </p>
          {listing.marketplaces.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {listing.marketplaces.map((mk) => (
                <li
                  key={mk}
                  className="rounded-full border border-line bg-surface-2 px-3 py-1 text-fg"
                >
                  {marketplaceLabel(mk)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-fg-muted">Nenhum marketplace.</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            Cálculo de margem
          </p>
          <p className="mt-1 text-fg">
            {listing.needsMargin ? (
              <>
                Sim
                {listing.taxRate !== null && (
                  <>
                    {" "}
                    · alíquota de{" "}
                    <span className="font-medium">{listing.taxRate}%</span>
                  </>
                )}
              </>
            ) : (
              "Não"
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
