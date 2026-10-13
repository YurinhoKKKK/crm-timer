import Link from "next/link";

// Abas do quadro Sucesso do Cliente: "Clientes" (o quadro atual) e "Controle de
// Churn" (rota própria /admin/sucesso-do-cliente/churn). Admin-only como o resto
// do CS. Presentacional — cada página passa qual aba está ativa.
export default function CsTabs({ active }: { active: "clientes" | "churn" }) {
  const tabs = [
    { key: "clientes" as const, label: "Clientes", href: "/admin/sucesso-do-cliente" },
    { key: "churn" as const, label: "Controle de Churn", href: "/admin/sucesso-do-cliente/churn" },
  ];
  return (
    <div className="mb-4 flex gap-1 border-b border-line" role="tablist" aria-label="Seções do Sucesso do Cliente">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            aria-current={on ? "page" : undefined}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risd ${
              on
                ? "border-risd text-fg"
                : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
